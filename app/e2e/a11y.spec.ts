/**
 * The accessibility scan: frostfall over the page states in e2e/frostfall/frostfall.yml,
 * against the app the global setup started.
 *
 * frostfall runs in a container from the same Playwright image as the browser tests, on
 * that image's Chromium, so the scan and the tests see the app in one pinned browser.
 * The binary is the Linux build `make _install-frostfall` fetched and checked against its
 * pinned sha256, mounted read-only; the Makefile passes its path in FROSTFALL_BIN.
 *
 * The scan fails on a violation rated serious or worse that baseline.json does not list,
 * and also on a baseline entry that no longer happens, so fixing one means removing its
 * entry. frostfall itself only warns about the second; the spec reads the count from the
 * job outputs frostfall writes. With FROSTFALL_UPDATE_BASELINE set (`make
 * a11y-baseline`), it rewrites baseline.json instead and the test passes.
 *
 * A second test checks baseline.json itself: every entry names a state the config still
 * scans, since frostfall never reports an entry of a removed state as stale, and every
 * entry has a note saying in words what fixes it or why it stands. Notes carry no issue
 * links or numbers: the vocabulary gate refuses the repository's URL under app/, and
 * Standard's export refuses citations, since they point at nothing in the exported
 * repository.
 *
 * The HTML report goes to frostfall-report/, which CI uploads.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

import { BROWSER_IMAGE } from "./global-setup";

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(E2E_DIR, "frostfall");
const REPORT_DIR = resolve(E2E_DIR, "..", "frostfall-report");
const UPDATE = !!process.env.FROSTFALL_UPDATE_BASELINE;

/** Where frostfall writes its counts (the file GitHub Actions calls GITHUB_OUTPUT). It
 *  only appends, so the file has to exist first. */
const OUTPUTS = "outputs.txt";

/** The shortest note that can say what fixes an entry or why it stands. */
const MIN_NOTE_LENGTH = 20;

/** An issue citation, which Standard's export refuses: `#` and two to four digits, or an
 *  issues URL. CI does not run the export, so the spec checks for it here. */
const CITATION = /#\d{2,4}\b|\/issues\/\d+/;

/** Runs frostfall on the image's Chromium, whose folder name differs by architecture.
 *  Without it frostfall would download a Chromium of its own, so a missing one stops
 *  the run with exit 3, as any other environment failure does. */
const FROSTFALL = [
  "sh",
  "-c",
  [
    'chrome="$(ls -d /ms-playwright/chromium-[0-9]*/chrome-linux*/chrome 2>/dev/null | head -n 1)"',
    '[ -x "$chrome" ] || { echo "No Chromium under /ms-playwright in the Playwright image." >&2; exit 3; }',
    'exec frostfall --browser-path "$chrome" "$@"',
  ].join("\n"),
  "frostfall",
  "--config",
  "/cfg/frostfall.yml",
  "--baseline",
  "/cfg/baseline.json",
];

type BaselineEntry = { testId: string; ruleId: string; note?: string };

test("no new accessibility violations", async () => {
  test.setTimeout(10 * 60_000);
  const bin = process.env.FROSTFALL_BIN;
  if (!bin) {
    throw new Error(
      "FROSTFALL_BIN is not set. Run make test-browser or make test-a11y, which fetch frostfall first.",
    );
  }
  const baseUrl = process.env.E2E_BASE_URL;
  if (!baseUrl)
    throw new Error("E2E_BASE_URL is not set; the global setup sets it.");

  rmSync(REPORT_DIR, { recursive: true, force: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(resolve(REPORT_DIR, OUTPUTS), "");

  let scanner: StartedTestContainer | undefined;
  try {
    scanner = await new GenericContainer(BROWSER_IMAGE)
      .withBindMounts([
        { source: bin, target: "/usr/local/bin/frostfall", mode: "ro" },
        // Writable only when rewriting the baseline, which frostfall replaces by rename.
        { source: CONFIG_DIR, target: "/cfg", mode: UPDATE ? "rw" : "ro" },
        { source: REPORT_DIR, target: "/out", mode: "rw" },
      ])
      .withExtraHosts([
        { host: "host.docker.internal", ipAddress: "host-gateway" },
      ])
      // The host's user, so what it writes to the mounts belongs to whoever ran the tests.
      .withUser(`${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`)
      .withEnvironment({
        HOME: "/tmp",
        E2E_BASE_URL: baseUrl,
        GITHUB_OUTPUT: `/out/${OUTPUTS}`,
      })
      .withWorkingDir("/out")
      .withCommand(["sleep", "infinity"])
      .start();

    if (UPDATE) {
      const run = await scanner.exec([...FROSTFALL, "--update-baseline"]);
      process.stdout.write(run.output);
      expect(run.exitCode, run.output).toBe(0);
      return;
    }

    const run = await scanner.exec([
      ...FROSTFALL,
      "--format",
      "html",
      "--output",
      "/out/frostfall-report.html",
      "--screenshots",
      "--screenshot-dir",
      "/out/frostfall-artifacts",
    ]);
    process.stdout.write(run.output);
    expect(
      run.exitCode,
      `frostfall exited ${run.exitCode}: 1 is a new violation rated serious or worse, 2 a bad config, 3 a page or step it could not reach.\n${run.output}`,
    ).toBe(0);

    const counts = Object.fromEntries(
      readFileSync(resolve(REPORT_DIR, OUTPUTS), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => line.split("=", 2) as [string, string]),
    );
    expect(
      counts["stale-baseline-entries"],
      `frostfall wrote no stale-baseline-entries count to ${OUTPUTS}, so the stale check cannot run.\n${run.output}`,
    ).toBeDefined();
    expect(
      Number(counts["stale-baseline-entries"]),
      `The baseline lists violations that no longer happen. If a fix removed them, run make a11y-baseline and commit the shorter list.\n${run.output}`,
    ).toBe(0);
  } finally {
    await scanner?.stop();
  }
});

test("every baseline entry names a scanned state and says what fixes it", () => {
  test.skip(UPDATE, "The baseline is being rewritten; notes are added after.");
  const config = readFileSync(resolve(CONFIG_DIR, "frostfall.yml"), "utf8");
  const ids = new Set(
    [...config.matchAll(/^ {2}- id: (\S+)$/gm)].map((m) => m[1]),
  );
  expect(ids.size, "Found no test ids in frostfall.yml").toBeGreaterThan(0);

  const baseline = JSON.parse(
    readFileSync(resolve(CONFIG_DIR, "baseline.json"), "utf8"),
  ) as { violations: BaselineEntry[] | null };
  // frostfall writes null, not an empty list, when nothing is baselined.
  const entries = baseline.violations ?? [];
  const orphaned = entries.filter((v) => !ids.has(v.testId));
  expect(
    orphaned.map((v) => `${v.testId} ${v.ruleId}`),
    "Baseline entries for states frostfall.yml no longer scans. frostfall never reports these as stale; remove them.",
  ).toEqual([]);
  const unexplained = entries.filter(
    (v) => (v.note ?? "").trim().length < MIN_NOTE_LENGTH,
  );
  expect(
    unexplained.map((v) => `${v.testId} ${v.ruleId}`),
    `Baseline entries without a note of at least ${MIN_NOTE_LENGTH} characters saying what fixes them or why they stand.`,
  ).toEqual([]);
  const cited = entries.filter((v) => CITATION.test(v.note ?? ""));
  expect(
    cited.map((v) => `${v.testId} ${v.ruleId}`),
    "Baseline entries whose note cites an issue. Say in words what fixes it; the export refuses citations.",
  ).toEqual([]);
});
