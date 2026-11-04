/**
 * Image-tag version guard (CLI). The comparison logic is in ./compare.ts and is
 * unit tested; this file is the IO around it.
 *
 *   --mode=repo
 *       Offline. Reads app/package.json and every environment's
 *       terraform.tfvars, and asserts no environment is pinned ahead of the
 *       version this repo has cut. Safe for CI; needs no credentials.
 *
 *   --mode=deploy --env=<env> --deployed=<tag>
 *       Compares the committed tag for that environment against the tag actually
 *       running. Fails on a downgrade, because applying one rolls the
 *       environment backwards — and if a migration has landed since, the older
 *       image fails at query time rather than at deploy. ALLOW_DOWNGRADE=1
 *       permits it for a deliberate rollback.
 *
 * Side-effectful (fs / argv / process.exit) → coverage-excluded; the logic it
 * calls is covered.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkDeploySafety,
  checkRepoConsistency,
  isOverridableByAllowDowngrade,
  type EnvTag,
  type Finding,
} from "./compare.js";

/** Repo root, from app/ where the scripts are run. */
const ROOT = resolve(process.cwd(), "..");
const ENVS = ["dev", "prod"];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

function packageVersion(): string {
  const raw = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
  const version = (JSON.parse(raw) as { version?: string }).version;
  if (!version) throw new Error("app/package.json has no version field");
  return version;
}

/** Read `container_image_tag` out of an environment's committed tfvars. */
function committedTag(env: string): string {
  const path = resolve(ROOT, `infra/environments/${env}/terraform.tfvars`);
  if (!existsSync(path)) {
    throw new Error(`No tfvars for env "${env}" at ${path}`);
  }
  const match = /^container_image_tag\s*=\s*"([^"]+)"/m.exec(
    readFileSync(path, "utf8"),
  );
  if (!match) {
    throw new Error(`No container_image_tag in ${path}`);
  }
  return match[1]!;
}

function report(findings: Finding[]): number {
  for (const f of findings) {
    const icon = f.severity === "error" ? "❌" : "⚠️ ";
    console.log(`  ${icon} [${f.code}] ${f.message}`);
  }
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}

function main(): void {
  const mode = arg("mode") ?? "repo";

  if (mode === "repo") {
    const version = packageVersion();
    const envTags: EnvTag[] = ENVS.map((env) => ({
      env,
      committed: committedTag(env),
    }));
    console.log(`[version-guard] app/package.json ${version}`);
    for (const { env, committed } of envTags) {
      console.log(`[version-guard] ${env} committed ${committed}`);
    }
    const code = report(checkRepoConsistency(version, envTags));
    console.log(
      code === 0
        ? "[version-guard] RESULT: PASS"
        : "[version-guard] RESULT: FAIL",
    );
    process.exit(code);
  }

  if (mode === "deploy") {
    const env = arg("env");
    const deployed = arg("deployed");
    // The version about to be deployed. `deploy` gates before set-version has
    // rewritten tfvars, so reading the file there would compare the OLD tag:
    // it would abort a legitimate forward deploy from a lagging tree, and wave
    // through a real change as a "no-op" when tfvars already matched.
    const committedOverride = arg("committed");
    if (!env || !deployed) {
      console.error(
        "usage: --mode=deploy --env=<dev|prod> --deployed=<tag or image ref>",
      );
      process.exit(64);
    }
    // Accept a full image ref and take the tag after the last colon.
    const deployedTag = deployed.includes(":")
      ? deployed.slice(deployed.lastIndexOf(":") + 1)
      : deployed;
    const committed = committedOverride
      ? committedOverride.replace(/^v?/, "v")
      : committedTag(env);
    const source = committedOverride ? "target" : "committed";
    console.log(
      `[version-guard] ${env}: running ${deployedTag}, ${source} ${committed}`,
    );
    const findings = checkDeploySafety(env, deployedTag, committed);
    let code = report(findings);
    // Scoped to the finding it names. An override called ALLOW_DOWNGRADE must
    // not clear some future unrelated error just because it is also an error.
    if (
      isOverridableByAllowDowngrade(findings) &&
      process.env.ALLOW_DOWNGRADE === "1"
    ) {
      console.log(
        "  ⚠️  ALLOW_DOWNGRADE=1 — proceeding with a deliberate rollback",
      );
      code = 0;
    }
    console.log(
      code === 0
        ? "[version-guard] RESULT: PASS"
        : "[version-guard] RESULT: FAIL",
    );
    process.exit(code);
  }

  console.error(`Unknown --mode=${mode} (expected "repo" or "deploy")`);
  process.exit(64);
}

main();
