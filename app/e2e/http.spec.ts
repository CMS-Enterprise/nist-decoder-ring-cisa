/**
 * The HTTP checks: emberfall sends the requests in e2e/emberfall/emberfall.yml to the app
 * the global setup started, and checks each response's status, and the header and body
 * fields the file lists, against what it expects.
 *
 * These cover the route handlers from outside: the health check, the export's files and
 * refusals, the proxy's redirects, and the tRPC handler. The unit tests beside each
 * handler cover the same answers in-process, with the database mocked; these run the
 * built server on a seeded Postgres, so they also check that Next routes each request to
 * the handler and that the answers survive the real database.
 *
 * emberfall runs in a container from the same Playwright image as the browser tests, as
 * frostfall does. The binary is the Linux build `make _install-emberfall` fetched and
 * checked against its pinned sha256, mounted read-only; the Makefile passes its path in
 * EMBERFALL_BIN.
 *
 * The app's address changes with every run, so emberfall.yml writes it as ${BASE_URL} and
 * this spec fills it in before the run. emberfall has no way to read the environment. The
 * filled-in copy goes under app/.emberfall/, as frostfall's mounts sit under app/: Docker
 * setups that share only the home folder (Colima's default) mount a folder outside it,
 * such as the macOS temp folder, empty.
 *
 * Neither emberfall nor the container's exec has a timeout, so the run goes under
 * `timeout`, and a hung handler fails with emberfall's output so far rather than as
 * Playwright's own timeout.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

import { BROWSER_IMAGE } from "./global-setup";

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG = resolve(E2E_DIR, "emberfall", "emberfall.yml");
const BASE_URL = "${BASE_URL}";
/** Gitignored, beside the binary make _install-emberfall fetches. */
const RUN_DIR = resolve(E2E_DIR, "..", ".emberfall", "run");
/** Seconds the whole run may take; it takes about 3. */
const RUN_TIMEOUT = 60;

// The keys emberfall reads, by where they sit (its config.go and test.go). It decodes the
// file without rejecting a key it has no field for, and checks a status or a header only
// when one is set, so a misspelled key turns its check off instead of failing it. Header
// names and JSON bodies are free-form and not checked here.
const REQUEST_KEYS = [
  "id",
  "url",
  "method",
  "headers",
  "follow",
  "body",
  "expect",
];
const EXPECT_KEYS = ["status", "headers", "body"];
const BODY_KEYS = ["json", "text", "multipart"];
// An expected body is compared as json or text only; emberfall never compares multipart.
const EXPECT_BODY_KEYS = ["json", "text"];
const MULTIPART_KEYS = ["fields", "files"];

/**
 * What is wrong with emberfall.yml's keys, one "line N: …" string each; none when every
 * request starts with its id and uses only emberfall's keys. The file is read by its
 * indentation, two spaces a level, the way the frostfall spec reads frostfall.yml's ids. A block whose keys are checked must use that
 * indent, so one indented any other way is named rather than skipped. YAML lines up a
 * block's keys with its first, so checking the first key under each such parent is
 * enough. A key may be bare or quoted, as YAML allows.
 */
function configProblems(source: string): string[] {
  const problems: string[] = [];
  const check = (n: number, key: string, allowed: string[], where: string) => {
    if (!allowed.includes(key))
      problems.push(
        `line ${n}: \`${key}\` is not an emberfall key ${where} (${allowed.join(", ")})`,
      );
  };
  const KEY = String.raw`(?:"([^"]+)"|'([^']+)'|([^\s:#'"][^:]*?))`;
  const keyLine = new RegExp(String.raw`^( *)(- )?${KEY}:(\s|$)`);
  const flowMap = new RegExp(String.raw`^\s*(- )?${KEY}:\s*\{`);
  let section = "";
  let subsection = "";
  // Where the first key of a block just opened must sit, when its keys are checked.
  let childAt: number | undefined;
  source.split("\n").forEach((line, i) => {
    const n = i + 1;
    if (/^\s*(#|$)/.test(line)) return;
    if (flowMap.test(line)) {
      problems.push(
        `line ${n}: write it one key per line; the check reads keys by line, not \`{…}\` maps`,
      );
      return;
    }
    const m = keyLine.exec(line);
    if (!m) return;
    const spaces = m[1] ?? "";
    const dash = m[2];
    const key = m[3] ?? m[4] ?? m[5] ?? "";
    const column = spaces.length + (dash ? 2 : 0);
    if (childAt !== undefined && column !== childAt)
      problems.push(
        `line ${n}: indent two spaces a level; the check reads keys by their column`,
      );
    childAt = undefined;
    if (column === 0) {
      if (key !== "tests") check(n, key, ["tests"], "at the top level");
    } else if (column === 4) {
      if (dash && spaces.length === 2 && key !== "id")
        problems.push(
          `line ${n}: a request starts with \`${key}\`; start it with its \`id\``,
        );
      check(n, key, REQUEST_KEYS, "on a request");
      section = key;
      subsection = "";
    } else if (column === 6) {
      if (section === "expect") check(n, key, EXPECT_KEYS, "under `expect`");
      if (section === "body") check(n, key, BODY_KEYS, "under `body`");
      subsection = key;
    } else if (column === 8) {
      if (section === "expect" && subsection === "body")
        check(n, key, EXPECT_BODY_KEYS, "under `expect.body`");
      if (section === "body" && subsection === "multipart")
        check(n, key, MULTIPART_KEYS, "under `body.multipart`");
    }
    const opensBlock =
      line.slice(m[0].length).replace(/#.*$/, "").trim() === "";
    if (
      opensBlock &&
      ((column === 0 && key === "tests") ||
        (column === 4 && (key === "expect" || key === "body")) ||
        (column === 6 && section === "expect" && key === "body") ||
        (column === 6 && section === "body" && key === "multipart"))
    )
      // A request's first key follows `  - `, at column 4; any other block's sits two in.
      childAt = key === "tests" ? 4 : column + 2;
  });
  return problems;
}

test("every endpoint answers as emberfall.yml expects", async () => {
  test.setTimeout(5 * 60_000);
  const bin = process.env.EMBERFALL_BIN;
  if (!bin) {
    throw new Error(
      "EMBERFALL_BIN is not set. Run make test-browser or make test-http, which fetch emberfall first.",
    );
  }
  const baseUrl = process.env.E2E_BASE_URL;
  if (!baseUrl)
    throw new Error("E2E_BASE_URL is not set; the global setup sets it.");

  const source = readFileSync(CONFIG, "utf8");
  expect(source, `emberfall.yml has no ${BASE_URL} to fill in`).toContain(
    BASE_URL,
  );
  mkdirSync(RUN_DIR, { recursive: true });
  const dir = mkdtempSync(join(RUN_DIR, "cfg-"));
  writeFileSync(
    join(dir, "emberfall.yml"),
    source.replaceAll(BASE_URL, baseUrl),
  );

  let checker: StartedTestContainer | undefined;
  try {
    checker = await new GenericContainer(BROWSER_IMAGE)
      .withBindMounts([
        { source: bin, target: "/usr/local/bin/emberfall", mode: "ro" },
        { source: dir, target: "/cfg", mode: "ro" },
      ])
      .withExtraHosts([
        { host: "host.docker.internal", ipAddress: "host-gateway" },
      ])
      .withUser(`${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`)
      .withCommand(["sleep", "infinity"])
      .start();

    const run = await checker.exec([
      "timeout",
      String(RUN_TIMEOUT),
      "emberfall",
      "--tests",
      "/cfg/emberfall.yml",
    ]);
    process.stdout.write(run.output);
    expect(
      run.exitCode,
      run.exitCode === 124
        ? `emberfall did not finish in ${RUN_TIMEOUT}s; its output so far is above.\n${run.output}`
        : `emberfall exited ${run.exitCode}: a FAIL line above names the request and what differed.\n${run.output}`,
    ).toBe(0);
    // emberfall drops a request whose URL template does not parse without counting it as
    // failed, and can still exit 0, so check that it ran every request the file declares.
    // Every request starts with its id (the test below), so counting the ids counts them all.
    const declared = source.match(/^ {2}- ["']?id["']?: /gm)?.length ?? 0;
    const ran = Number(/^\s*Ran: (\d+)$/m.exec(run.output)?.[1]);
    expect(declared, "Found no requests in emberfall.yml").toBeGreaterThan(0);
    expect(
      ran,
      `emberfall.yml declares ${declared} requests and emberfall ran ${ran}.\n${run.output}`,
    ).toBe(declared);
  } finally {
    await checker?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every request in emberfall.yml starts with its id and uses only keys emberfall reads", () => {
  expect(
    configProblems(readFileSync(CONFIG, "utf8")),
    "emberfall ignores a key it does not read, so a misspelled key turns its check off rather than failing, and the spec counts requests by their ids. Fix each line named.",
  ).toEqual([]);
});

test("the key check names a misspelled key and a request that does not start with its id", () => {
  const ok =
    "tests:\n  - id: a\n    url: x\n    method: GET\n    expect:\n      status: 200\n      body:\n        json:\n          anything: goes\n";
  expect(configProblems(ok)).toEqual([]);
  expect(configProblems(ok.replace("      status:", "      stauts:"))).toEqual([
    "line 6: `stauts` is not an emberfall key under `expect` (status, headers, body)",
  ]);
  expect(configProblems(ok.replace("    expect:", "    expcet:"))).toEqual([
    "line 5: `expcet` is not an emberfall key on a request (id, url, method, headers, follow, body, expect)",
  ]);
  expect(configProblems(ok.replace("      body:", "      header:"))).toEqual([
    "line 7: `header` is not an emberfall key under `expect` (status, headers, body)",
  ]);
  expect(
    configProblems("tests:\n  - id: a\n    expect: {stauts: 200}\n"),
  ).toEqual([
    "line 3: write it one key per line; the check reads keys by line, not `{…}` maps",
  ]);
  expect(configProblems("tests:\n  - url: x\n    id: a\n")).toEqual([
    "line 2: a request starts with `url`; start it with its `id`",
  ]);
  // A quoted key is still a key.
  expect(
    configProblems(ok.replace("      status:", '      "stauts":')),
  ).toEqual([
    "line 6: `stauts` is not an emberfall key under `expect` (status, headers, body)",
  ]);
  // A block indented other than two spaces in is named, not skipped: YAML reads it the
  // same, so a misspelled key inside it would otherwise go unchecked.
  const indent =
    "line 6: indent two spaces a level; the check reads keys by their column";
  expect(
    configProblems(
      "tests:\n  - id: a\n    url: x\n    method: GET\n    expect:\n        stauts: 200\n",
    ),
  ).toEqual([indent]);
  expect(
    configProblems(
      "tests:\n  - id: a\n    url: x\n    method: GET\n    expect: # what comes back\n        status: 200\n",
    ),
  ).toEqual([indent]);
  expect(configProblems("tests:\n- id: a\n  url: x\n")).toEqual([
    "line 2: indent two spaces a level; the check reads keys by their column",
  ]);
});
