/**
 * Version comparison and deploy-safety logic for the image tag.
 *
 * Pure and side-effect free so it can be unit tested. The IO — reading
 * package.json, the per-env tfvars, and the deployed task definition — lives in
 * ./index.ts.
 *
 * Why this exists: `container_image_tag` is per environment while
 * `app/package.json` version is global, so bumping the version for one
 * environment desynchronizes the other by construction. Left unchecked, the
 * committed tag drifts behind what is actually running, and then an apply from
 * the default branch silently moves an environment *backwards*. That is worse than a stale
 * tag: rolling an image back across a migration boundary leaves new schema under
 * old code, which fails at the query rather than at the deploy.
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Accepts `1.2.3` or `v1.2.3`. Throws on anything else — a tag we cannot parse is not a tag we may compare. */
export function parseSemver(input: string): Semver {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(input.trim());
  if (!match) {
    throw new Error(
      `Not a comparable version: "${input}" (expected X.Y.Z or vX.Y.Z)`,
    );
  }
  const [major, minor, patch] = [match[1]!, match[2]!, match[3]!].map((seg) => {
    const n = Number(seg);
    // Past Number.MAX_SAFE_INTEGER distinct integers collapse onto the same
    // value, so an oversized segment would make a real downgrade compare equal
    // and pass the gate. Round-tripping catches that, and also rejects
    // non-canonical forms like `01.2.4` whose digits do not survive the trip.
    if (String(n) !== seg) {
      throw new Error(
        `Not a comparable version: "${input}" (segment "${seg}" is not a canonical, exactly-representable integer)`,
      );
    }
    return n;
  });
  return { major: major!, minor: minor!, patch: patch! };
}

/** -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
}

/** True when applying `committed` over `deployed` would move the environment backwards. */
export function isDowngrade(deployed: string, committed: string): boolean {
  return compareVersions(committed, deployed) < 0;
}

export type Severity = "error" | "warn";

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
}

export interface EnvTag {
  env: string;
  /** The tag committed in that environment's terraform.tfvars. */
  committed: string;
}

/**
 * Offline invariant, checkable in CI with no AWS access.
 *
 * An environment may legitimately lag the package version — that is a rollout in
 * progress. What is never legitimate is an environment pinned *ahead* of the
 * package version, because the image for that tag was never versioned here.
 */
export function checkRepoConsistency(
  packageVersion: string,
  envTags: EnvTag[],
): Finding[] {
  const findings: Finding[] = [];
  for (const { env, committed } of envTags) {
    const cmp = compareVersions(committed, packageVersion);
    if (cmp > 0) {
      findings.push({
        severity: "error",
        code: "TAG_AHEAD_OF_PACKAGE",
        message: `${env} pins ${committed} but app/package.json is ${packageVersion}. An environment cannot deploy a version this repo has never cut.`,
      });
    } else if (cmp < 0) {
      findings.push({
        severity: "warn",
        code: "TAG_BEHIND_PACKAGE",
        message: `${env} pins ${committed} while app/package.json is ${packageVersion}. Expected mid-rollout; stale otherwise — confirm with 'make check-deploy-safety ENV=${env}'.`,
      });
    }
  }
  return findings;
}

/**
 * Online invariant, the one that catches a real regression: what the repo would
 * apply versus what is actually running.
 *
 * A downgrade is an error rather than a warning. It is occasionally what you
 * want — a deliberate rollback — which is why the caller carries an explicit
 * override rather than this returning a softer severity.
 */
export function checkDeploySafety(
  env: string,
  deployed: string,
  committed: string,
): Finding[] {
  if (isDowngrade(deployed, committed)) {
    return [
      {
        severity: "error",
        code: "WOULD_DOWNGRADE",
        message: `${env} runs ${deployed} but the tag being applied is ${committed}. Applying would roll it BACKWARDS. If a migration has run since ${committed}, the older image will fail at query time rather than at deploy. Land the release commit first, or pass ALLOW_DOWNGRADE=1 for a deliberate rollback.`,
      },
    ];
  }
  if (compareVersions(committed, deployed) === 0) {
    return [
      {
        severity: "warn",
        code: "TAG_MATCHES_DEPLOYED",
        message: `${env} already runs ${deployed}; the image tag is a no-op in this apply.`,
      },
    ];
  }
  return [];
}

/**
 * Whether ALLOW_DOWNGRADE may clear these findings.
 *
 * True only when every error present is the downgrade the override names. An
 * override is a permission to do one specific known-risky thing, not a blanket
 * mute: if a future check starts reporting a different error, this returns false
 * and the gate still fails.
 */
export function isOverridableByAllowDowngrade(findings: Finding[]): boolean {
  const errors = findings.filter((f) => f.severity === "error");
  return errors.length > 0 && errors.every((f) => f.code === "WOULD_DOWNGRADE");
}
