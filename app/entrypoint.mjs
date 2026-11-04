#!/usr/bin/env node
/**
 * ECS container entrypoint for ZT Decoder Ring.
 *
 * Responsibilities:
 *  1. Read the RDS-managed master user secret from Secrets Manager
 *     (ARN is passed via the DB_SECRET_ARN env var from the ECS task def).
 *  2. Compose the full Prisma-compatible DATABASE_URL using the secret's
 *     username/password and the discrete DB_HOST / DB_PORT / DB_NAME env
 *     vars (also from the task def).
 *  3. Exec whatever argv was passed (Docker CMD or ECS command override):
 *       - Default app boot: ENTRYPOINT + CMD ["node", "server.js"].
 *       - Migration task:   ECS command override ["node", "node_modules/.bin/prisma", "migrate", "deploy"].
 *       - Seed task:        ECS command override ["node", "--import", "tsx", "prisma/seed-ecs.ts"].
 *
 * Why a node-based entrypoint and not a shell wrapper?
 *   Docker Hardened Images ship no shell, so a bash entrypoint doesn't
 *   work. Node is already in the image — re-using it here is the
 *   cleanest way to do runtime config composition + forwarding.
 *
 * Why compose DATABASE_URL here instead of wiring the app to read
 * discrete vars?
 *   Prisma (app/src/server/db.ts, app/prisma/schema.prisma) reads a
 *   single DATABASE_URL string. Changing that contract is a larger
 *   app-level refactor. Composing here keeps the app unchanged and
 *   keeps RDS-managed password rotation working — on the next task
 *   restart, we fetch whatever the current secret value is.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

function fail(message) {
  process.stderr.write(`[entrypoint] ${message}\n`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Missing required env var: ${name}`);
  }
  return value;
}

async function composeDatabaseUrl() {
  const dbHost = required("DB_HOST");
  const dbPort = process.env.DB_PORT ?? "5432";
  const dbName = required("DB_NAME");
  const dbSecretArn = required("DB_SECRET_ARN");
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

  const client = new SecretsManagerClient({ region });
  let secretJson;
  try {
    const out = await client.send(new GetSecretValueCommand({ SecretId: dbSecretArn }));
    if (!out.SecretString) {
      fail(`Secret ${dbSecretArn} has no SecretString payload`);
    }
    secretJson = JSON.parse(out.SecretString);
  } catch (err) {
    fail(`Failed to read secret ${dbSecretArn}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { username, password } = secretJson;
  if (!username || !password) {
    fail(`Secret payload missing username/password keys`);
  }

  // TLS: verify the full RDS server-certificate chain AND server identity
  // (sslmode=verify-full) against the AWS RDS global CA bundle baked into the
  // image (see Dockerfile). Satisfies FedRAMP SC-8/SC-13 — encrypted transport
  // plus server-identity verification — closing the prior sslmode=require gap
  // (encrypted but unverified).
  //
  // One composed URL configures all three DB consumers:
  //   - app (src/server/db.ts) and seed (prisma/seed-ecs.ts) connect via
  //     node-postgres. Under uselibpqcompat=true, pg-connection-string maps
  //     sslmode=verify-full -> ssl {} (verify CA + identity) and reads
  //     sslrootcert=<file> into ssl.ca. No app-side SSL config is needed, and
  //     we must NOT pass a separate pg `ssl` object: pg-connection-string
  //     REPLACES it whenever the connection string carries sslmode/sslrootcert.
  //   - prisma migrate deploy (Rust schema engine) reads sslmode=verify-full
  //     AND sslrootcert from the URL directly; PGSSLROOTCERT is also exported
  //     below as a libpq belt-and-suspenders.
  //
  // Connect via the RDS endpoint DNS (DB_HOST) so verify-full's hostname check
  // matches the server-cert SAN. The migrate path's verify-full behavior is
  // validated by running the dev migrate task before prod relies on it.
  //
  // composeDatabaseUrl only runs when connecting to RDS via the managed secret
  // (DB_SECRET_ARN is required above), so verify-full must always hold. The CA
  // bundle is baked into the runner image at the default path; a missing bundle
  // is a misconfiguration (e.g. PGSSLROOTCERT overridden to a nonexistent
  // path), so we FAIL rather than silently downgrade to an unverified
  // connection — a silent downgrade would be an undetectable SC-8/SC-13 control
  // violation in production.
  const caBundlePath = process.env.PGSSLROOTCERT ?? "/etc/ssl/rds-global-bundle.pem";
  if (!existsSync(caBundlePath)) {
    fail(`RDS CA bundle not found at ${caBundlePath}; refusing to connect without sslmode=verify-full. Rebuild the image or fix PGSSLROOTCERT.`);
  }
  process.env.PGSSLROOTCERT = caBundlePath;
  const sslQuery = `sslmode=verify-full&sslrootcert=${encodeURIComponent(caBundlePath)}&uselibpqcompat=true`;
  const url = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${dbHost}:${dbPort}/${dbName}?${sslQuery}`;
  process.env.DATABASE_URL = url;

  process.stdout.write(`[entrypoint] DATABASE_URL composed for ${dbHost}:${dbPort}/${dbName} (user=${username})\n`);
}

function execArgv() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    fail("No command provided to entrypoint (expected Dockerfile CMD or ECS command override)");
  }

  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: process.env,
  });

  // Propagate termination signals to the child so ECS task shutdown works.
  const forward = (signal) => () => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  process.on("SIGTERM", forward("SIGTERM"));
  process.on("SIGINT", forward("SIGINT"));

  child.on("exit", (code, signal) => {
    if (signal) {
      // Re-raise the signal so the OS reports our exit the same way the
      // child exited. If we mapped signal-termination to exit code 1
      // instead, ECS would record a non-zero exit on every normal
      // SIGTERM (scale-down, rolling deploy) and trip the deployment
      // circuit breaker.
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (err) => {
    fail(`Failed to spawn child process: ${err.message}`);
  });
}

(async () => {
  // Local/dev path: when a DATABASE_URL is supplied directly and there is no
  // DB_SECRET_ARN, use it as-is and skip Secrets Manager + RDS TLS composition.
  // This lets the SAME hardened runner image run locally (docker compose,
  // `make container-up`) against a plain Postgres. In AWS the task def always
  // sets DB_SECRET_ARN (and never DATABASE_URL), so the managed-secret +
  // verify-full path is unchanged in every deployed environment.
  if (process.env.DATABASE_URL && !process.env.DB_SECRET_ARN) {
    process.stdout.write(
      "[entrypoint] Using provided DATABASE_URL (DB_SECRET_ARN unset — local mode)\n",
    );
  } else {
    await composeDatabaseUrl();
  }
  execArgv();
})().catch((err) => {
  fail(`Unhandled entrypoint error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
});
