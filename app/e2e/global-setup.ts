/**
 * Playwright globalSetup for the browser tests.
 *
 * Starts three things and returns the teardown that stops them in reverse order,
 * whether the tests passed or not:
 *
 * 1. A throwaway Postgres, migrated and seeded by the integration harness's own
 *    `applyMigrations` and `loadSeed`, so the browser tests and the integration
 *    tests read the same database.
 * 2. The built app: the standalone server `next build` writes, the same server the
 *    runner image ships. The image itself is not built here: its base images come
 *    from dhi.io, which needs a login CI does not have.
 * 3. A browser, in Microsoft's Playwright image pinned by digest, serving
 *    `playwright run-server`. The server is the `playwright-core` from node_modules,
 *    mounted read-only, so it is the copy yarn.lock checks by hash rather than one
 *    `npx` would fetch at run time. Its version must equal the image's tag, which
 *    is checked before anything starts.
 *
 * Both containers go through testcontainers, so its reaper removes them if this
 * process dies before the teardown runs.
 *
 * The browser reaches the app at host.docker.internal, mapped to the host's gateway
 * so the same address works on Docker Desktop and on a Linux runner. That address is
 * the browser's; code running in the test process itself reaches the app at
 * E2E_HOST_URL instead.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";

import { POSTGRES_IMAGE } from "../src/test/db/global-setup";
import { applyMigrations } from "../src/test/db/migrate";
import { loadSeed } from "../src/test/db/seed";

/** Microsoft's Playwright image. The tag's version must match @playwright/test's. */
export const BROWSER_IMAGE =
  "mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_JS = resolve(APP_DIR, ".next/standalone/app/server.js");
const BROWSER_PORT = 3000;
const APP_START_TIMEOUT_MS = 60_000;
const APP_STOP_TIMEOUT_MS = 5_000;

export function imageVersion(image: string): string | null {
  return /:v(\d+\.\d+\.\d+)-/.exec(image)?.[1] ?? null;
}

/** A port nothing is listening on. Nothing holds it between this returning and the app
 *  binding it, so another process can take it in between; the health check then fails
 *  and prints the app's output. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else reject(new Error("Could not find a free port"));
      });
    });
  });
}

/** The app's environment: this process's, less any AUTH_ setting from the shell, so
 *  sign-in stays off and a partial OIDC setup can't stop the app from starting. */
function appEnv(databaseUrl: string, port: number): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("AUTH_")),
  );
  return {
    ...env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: randomBytes(32).toString("hex"),
    PORT: String(port),
    HOSTNAME: "0.0.0.0",
  };
}

/** SIGTERM, then SIGKILL if the app has not exited within APP_STOP_TIMEOUT_MS.
 *  Playwright has no global timeout by default, so a server that ignored SIGTERM would
 *  otherwise hang the run. */
async function stopApp(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null || app.signalCode !== null) return;
  const exited = new Promise<void>((r) => app.once("exit", () => r()));
  app.kill("SIGTERM");
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((r) => {
    timer = setTimeout(() => r("timeout"), APP_STOP_TIMEOUT_MS);
  });
  const result = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  if (result === "timeout") {
    process.stderr.write(
      `[browser-tests] The app did not exit within ${APP_STOP_TIMEOUT_MS / 1000}s of SIGTERM; sending SIGKILL.\n`,
    );
    app.kill("SIGKILL");
    await exited;
  }
}

async function waitForHealth(
  url: string,
  app: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + APP_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) {
      throw new Error(
        `The app exited with code ${app.exitCode} before it answered.\n${output()}`,
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `The app did not answer ${url} within ${APP_START_TIMEOUT_MS / 1000}s.\n${output()}`,
  );
}

export default async function globalSetup() {
  const require = createRequire(import.meta.url);
  const playwrightVersion = (
    require("playwright-core/package.json") as { version: string }
  ).version;
  if (imageVersion(BROWSER_IMAGE) !== playwrightVersion) {
    throw new Error(
      `BROWSER_IMAGE is for Playwright ${imageVersion(BROWSER_IMAGE)}, but node_modules has ${playwrightVersion}. Move both together.`,
    );
  }
  if (!existsSync(SERVER_JS)) {
    throw new Error(
      `No built app at ${SERVER_JS}. Run make test-browser, which builds it first.`,
    );
  }

  const stops: (() => Promise<unknown>)[] = [];
  const teardown = async () => {
    for (const stop of stops.reverse()) {
      try {
        await stop();
      } catch (err) {
        process.stderr.write(
          `[browser-tests] Teardown step failed; the testcontainers reaper removes what is left: ${String(err)}\n`,
        );
      }
    }
  };

  try {
    const db = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    stops.push(() => db.stop());
    const databaseUrl = db.getConnectionUri();
    applyMigrations(databaseUrl);
    await loadSeed(databaseUrl);

    const port = await freePort();
    const lines: string[] = [];
    const keep = (chunk: Buffer) => {
      lines.push(...chunk.toString().split("\n"));
      lines.splice(0, Math.max(0, lines.length - 200));
    };
    const app = spawn(process.execPath, [SERVER_JS], {
      cwd: dirname(SERVER_JS),
      env: appEnv(databaseUrl, port),
      stdio: ["ignore", "pipe", "pipe"],
    });
    app.stdout?.on("data", keep);
    app.stderr?.on("data", keep);
    stops.push(() => stopApp(app));
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, app, () =>
      lines.join("\n"),
    );

    const browser = await new GenericContainer(BROWSER_IMAGE)
      .withBindMounts([
        {
          source: dirname(require.resolve("playwright-core/package.json")),
          target: "/pw",
          mode: "ro",
        },
      ])
      .withExtraHosts([
        { host: "host.docker.internal", ipAddress: "host-gateway" },
      ])
      .withExposedPorts(BROWSER_PORT)
      .withUser("pwuser")
      .withWorkingDir("/home/pwuser")
      .withCommand([
        "node",
        "/pw/cli.js",
        "run-server",
        "--port",
        String(BROWSER_PORT),
        "--host",
        "0.0.0.0",
      ])
      .withWaitStrategy(Wait.forLogMessage(/Listening on/))
      .start();
    stops.push(() => browser.stop());

    process.env.E2E_BASE_URL = `http://host.docker.internal:${port}`;
    process.env.E2E_HOST_URL = `http://127.0.0.1:${port}`;
    process.env.E2E_BROWSER_WS_ENDPOINT = `ws://${browser.getHost()}:${browser.getMappedPort(BROWSER_PORT)}/`;
  } catch (err) {
    await teardown();
    throw err;
  }

  return teardown;
}
