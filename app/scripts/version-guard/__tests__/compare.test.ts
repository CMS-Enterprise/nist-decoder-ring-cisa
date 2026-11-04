/**
 * Unit tests for the image-tag version guard.
 *
 * The case that matters most is pinned by name: prod running v0.1.11 with the
 * repo committing v0.1.9 must be reported as a downgrade. It is easy to miss
 * when the only check is someone reading two files and comparing them by eye.
 */

import { describe, it, expect } from "vitest";
import {
  parseSemver,
  compareVersions,
  isDowngrade,
  checkRepoConsistency,
  checkDeploySafety,
  isOverridableByAllowDowngrade,
  type Finding,
} from "../compare.js";

describe("parseSemver", () => {
  it("accepts both the bare and v-prefixed forms, since tfvars uses one and package.json the other", () => {
    expect(parseSemver("0.1.11")).toEqual({ major: 0, minor: 1, patch: 11 });
    expect(parseSemver("v0.1.11")).toEqual({ major: 0, minor: 1, patch: 11 });
    expect(parseSemver("  v1.2.3  ")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it.each([
    ["", "empty"],
    ["v", "prefix only"],
    ["1.2", "missing patch"],
    ["1.2.3.4", "too many segments"],
    ["latest", "a moving tag"],
    ["v1.2.3-rc1", "a prerelease this project does not use"],
    ["sha256:abc", "a digest"],
    ["01.2.4", "a non-canonical leading zero"],
    ["1.2.9007199254740993", "a segment past Number.MAX_SAFE_INTEGER"],
  ])("refuses %s (%s) rather than guessing", (input) => {
    expect(() => parseSemver(input)).toThrow(/Not a comparable version/);
  });

  it("refuses oversized segments rather than collapsing two versions onto one", () => {
    // Number() maps both of these to 9007199254740992, so without the
    // round-trip check they compare equal and a real downgrade passes the gate.
    expect(() =>
      compareVersions("1.2.9007199254740993", "1.2.9007199254740992"),
    ).toThrow(/Not a comparable version/);
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("0.1.9", "0.1.11")).toBe(-1);
    expect(compareVersions("0.1.11", "0.1.9")).toBe(1);
    expect(compareVersions("v0.1.11", "0.1.11")).toBe(0);
  });

  it("compares patch numerically, not lexically — 9 vs 11 is the trap", () => {
    // String comparison would put "0.1.9" after "0.1.11" and hide the downgrade.
    expect(compareVersions("0.1.9", "0.1.11")).toBe(-1);
    expect("0.1.9" > "0.1.11").toBe(true); // the wrong answer, pinned deliberately
  });
});

describe("isDowngrade", () => {
  it("flags a downgrade: prod on v0.1.11, repo on v0.1.9", () => {
    expect(isDowngrade("v0.1.11", "v0.1.9")).toBe(true);
  });

  it("does not flag a forward move or a no-op", () => {
    expect(isDowngrade("v0.1.9", "v0.1.11")).toBe(false);
    expect(isDowngrade("v0.1.11", "v0.1.11")).toBe(false);
  });
});

describe("checkRepoConsistency", () => {
  it("errors when an environment pins a version the repo never cut", () => {
    const findings = checkRepoConsistency("0.1.9", [
      { env: "prod", committed: "v0.1.11" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      code: "TAG_AHEAD_OF_PACKAGE",
    });
  });

  it("warns rather than errors when an environment lags, since that is a rollout in progress", () => {
    // A rollout in progress: package.json 0.1.10, both environments still on v0.1.9.
    const findings = checkRepoConsistency("0.1.10", [
      { env: "dev", committed: "v0.1.9" },
      { env: "prod", committed: "v0.1.9" },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === "warn")).toBe(true);
    expect(findings.every((f) => f.code === "TAG_BEHIND_PACKAGE")).toBe(true);
  });

  it("is silent when everything agrees", () => {
    expect(
      checkRepoConsistency("0.1.11", [
        { env: "dev", committed: "v0.1.11" },
        { env: "prod", committed: "v0.1.11" },
      ]),
    ).toEqual([]);
  });
});

describe("checkDeploySafety", () => {
  it("errors on the exact case that would have broken prod", () => {
    const findings = checkDeploySafety("prod", "v0.1.11", "v0.1.9");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.code).toBe("WOULD_DOWNGRADE");
    // The message has to say why a rollback is not merely a version change.
    expect(findings[0]?.message).toMatch(/migration/i);
  });

  it("reports a no-op when the committed tag already matches what runs", () => {
    const findings = checkDeploySafety("prod", "v0.1.11", "v0.1.11");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warn",
      code: "TAG_MATCHES_DEPLOYED",
    });
  });

  it("is silent on a normal forward deploy", () => {
    expect(checkDeploySafety("dev", "v0.1.9", "v0.1.11")).toEqual([]);
  });

  it("throws rather than passing when the deployed tag is unparseable", () => {
    // A task definition pinned to a digest or a moving tag must stop the gate,
    // not slip through as "not a downgrade".
    expect(() => checkDeploySafety("prod", "latest", "v0.1.11")).toThrow(
      /Not a comparable version/,
    );
  });
});

describe("isOverridableByAllowDowngrade", () => {
  const downgrade: Finding = {
    severity: "error",
    code: "WOULD_DOWNGRADE",
    message: "x",
  };
  const other: Finding = {
    severity: "error",
    code: "SOMETHING_ELSE",
    message: "x",
  };
  const warning: Finding = {
    severity: "warn",
    code: "TAG_MATCHES_DEPLOYED",
    message: "x",
  };

  it("permits the override for the finding it is named after", () => {
    expect(isOverridableByAllowDowngrade([downgrade])).toBe(true);
    expect(isOverridableByAllowDowngrade([downgrade, warning])).toBe(true);
  });

  it("refuses to let a downgrade override mute an unrelated error", () => {
    // The point of scoping it: a blanket "code !== 0" check would wave this
    // through, so a future check would be silently disabled by an unrelated flag.
    expect(isOverridableByAllowDowngrade([downgrade, other])).toBe(false);
    expect(isOverridableByAllowDowngrade([other])).toBe(false);
  });

  it("has nothing to override when there are no errors", () => {
    expect(isOverridableByAllowDowngrade([])).toBe(false);
    expect(isOverridableByAllowDowngrade([warning])).toBe(false);
  });
});
