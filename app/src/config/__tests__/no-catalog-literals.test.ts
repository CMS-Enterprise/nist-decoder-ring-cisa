/**
 * No catalog vocabulary anywhere in what this line ships.
 *
 * `product.test.ts` proves the Standard config carries no catalog vocabulary. It
 * cannot prove the app *uses* the config everywhere, and that gap is not
 * hypothetical: the page's `<h1>` and the document `<title>` both shipped one
 * catalog's branding after the config landed, because a hand audit searched quoted
 * strings inside one component directory and those two were neither.
 *
 * So this sweeps every tracked text file that ships, tests and comments included, and
 * fails naming the file and line. It was rendering sources only, with test
 * directories and whole-comment lines skipped: that left 135 mentions across 16 files
 * sitting in fixtures, test names and comments with the gate green. It then covered
 * `src/` and `scripts/` only, and a term planted in the schema, a generator, the
 * Terraform, a runbook or the README passed it. A fixture is committed and read like
 * any other file, and a name in a comment is a name in the repository. A slot that has
 * not been created yet is the finding, not an exception.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The term list and the line scanner are shared with the product tests rather than
 * restated here, so every gate judges the tree against one definition.
 */
import { CATALOG_MARKERS, offendingLines } from "../catalog-vocabulary";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * What ships, as paths from the repository root:
 *   - `app/`, except `app/prisma/migrations/`
 *   - `scripts/`, `infra/`, `backend/`, `docs/runbooks/` and `docs/scripts/`, whole
 *   - the files directly in `docs/` and in `docs/architecture/`, not their other folders
 *   - every top-level file except Markdown, and `README.md`
 * The migrations are left out because the export replaces them with one baseline built
 * from the schema this sweep covers. The seed SQL is swept like everything else: it is
 * the prose the line serves. `docs/`'s other folders, the other top-level Markdown and
 * `.github/` are the export's to remove or rewrite.
 */
function ships(path: string): boolean {
  if (path.startsWith("app/"))
    return !path.startsWith("app/prisma/migrations/");
  if (/^(scripts|infra|backend|docs\/runbooks|docs\/scripts)\//.test(path))
    return true;
  if (/^docs\/(architecture\/)?[^/]+$/.test(path)) return true;
  return !path.includes("/") && (!path.endsWith(".md") || path === "README.md");
}

/** Files the scanner cannot read as text. */
const BINARY = /\.(ico|png|jpe?g|gif|webp|pdf|xlsx|zip|gz|woff2?|ttf)$/i;

/**
 * Files `.gitattributes` marks `binary`, which git neither diffs nor merges as text.
 * The one such file is the Yarn release under `app/.yarn/releases/`, a minified
 * third-party bundle whose package tables name other projects' npm packages. The
 * test below holds the marking to that folder, so marking a file binary is not a way
 * around the sweep.
 */
function markedBinary(paths: string[]): Set<string> {
  const out = execFileSync("git", ["check-attr", "-z", "--stdin", "binary"], {
    cwd: REPO,
    encoding: "utf8",
    input: paths.join("\0"),
  }).split("\0");
  const marked = new Set<string>();
  // -z output is path, attribute, value, repeated.
  for (let i = 0; i + 2 < out.length; i += 3) {
    const path = out[i];
    if (path && out[i + 2] === "set") marked.add(path);
  }
  return marked;
}

/**
 * Where the vocabulary is legitimately allowed to appear verbatim: the term list, this
 * file, and the generators' boundary tests, each of which names what it bans. Nothing
 * else. The product config used to be here for the other product's values; this line
 * has one product and it fills no slot with another catalog's words.
 */
const ALLOWED = [
  "app/src/config/catalog-vocabulary.ts",
  "app/src/config/__tests__/no-catalog-literals.test.ts",
  "app/prisma/generators/catalog/__tests__/boundary.test.ts",
  "app/prisma/generators/reference-links/__tests__/boundary.test.ts",
  "app/prisma/generators/zt-overlay/__tests__/boundary.test.ts",
  "app/prisma/generators/zt-reference-links/__tests__/boundary.test.ts",
];

/** Tracked files only: an untracked local override is nobody else's to fail on. */
function tracked(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

describe("catalog vocabulary in what the line ships", () => {
  const all = tracked();
  const binary = markedBinary(all);
  const files = all.filter(
    (f) =>
      ships(f) && !BINARY.test(f) && !binary.has(f) && !ALLOWED.includes(f),
  );

  it("skips as binary only the committed Yarn release", () => {
    expect(
      [...binary].filter(
        (f) => !BINARY.test(f) && !f.startsWith("app/.yarn/releases/"),
      ),
    ).toEqual([]);
  });

  it("has sources to sweep", () => {
    // A sweep over nothing passes every assertion below. 343 files today; the floor
    // catches a broken walk or a missing git, not a deleted file.
    expect(files.length).toBeGreaterThan(250);
  });

  it("flags every term and passes a clean line", () => {
    // The scanner's own behaviour, so a green sweep means the tree is clean rather
    // than that the scanner matched nothing.
    for (const term of CATALOG_MARKERS) {
      expect(offendingLines(`a line naming ${term} in passing`)).toHaveLength(
        1,
      );
      expect(offendingLines(`x${term}y`)).toHaveLength(
        /^[\w ]+$/.test(term) ? 0 : 1,
      );
    }
    expect(
      offendingLines("a control from the catalog\nand its discussion"),
    ).toEqual([]);
  });

  it("names no catalog anywhere", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of offendingLines(
        readFileSync(join(REPO, file), "utf8"),
      )) {
        offenders.push(`${file}:${hit}`);
      }
    }
    // Each of these is a name this line does not carry. The fix is a neutral word,
    // a slot in product.ts, or a neutral fixture, never an entry in ALLOWED.
    expect(offenders).toEqual([]);
  });
});
