// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type * as NodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  availableCatalogs,
  requestedCatalog,
  resolveCatalogDir,
  SEED_ROOT,
  seedFilesIn,
} from "../catalog-dir";

// readdirSync passes through to the real one, so a test can hand seedFilesIn a listing
// in an order the filesystem would not produce.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "catalog-dir-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("SEED_ROOT", () => {
  it("is the committed seed beside the loader, wherever the run starts", () => {
    expect(SEED_ROOT).toMatch(/[/\\]prisma[/\\]seed-sql$/);
    expect(existsSync(join(SEED_ROOT, "nist-800-53", "00-cleanup.sql"))).toBe(
      true,
    );
  });
});

describe("availableCatalogs", () => {
  it("lists the directories, sorted, and nothing else", () => {
    mkdirSync(join(root, "zeta"));
    mkdirSync(join(root, "alpha"));
    writeFileSync(join(root, "notes.txt"), "");
    symlinkSync(join(root, "gone"), join(root, "dangling"));
    expect(availableCatalogs(root)).toEqual(["alpha", "zeta"]);
  });

  it("is empty when the seed root is missing", () => {
    expect(availableCatalogs(join(root, "missing"))).toEqual([]);
  });
});

describe("requestedCatalog", () => {
  it("takes the flag over the environment", () => {
    vi.stubEnv("SEED_CATALOG", "from-env");
    expect(requestedCatalog(["node", "seed.ts", "--catalog=from-flag"])).toBe(
      "from-flag",
    );
  });

  it("falls back to SEED_CATALOG, trimmed", () => {
    vi.stubEnv("SEED_CATALOG", " from-env ");
    expect(requestedCatalog(["node", "seed.ts"])).toBe("from-env");
  });

  it("treats an empty flag or variable as not set", () => {
    vi.stubEnv("SEED_CATALOG", "from-env");
    expect(requestedCatalog(["node", "seed.ts", "--catalog= "])).toBe(
      undefined,
    );
    vi.stubEnv("SEED_CATALOG", "");
    expect(requestedCatalog(["node", "seed.ts"])).toBe(undefined);
  });

  it("is undefined when neither is given", () => {
    vi.stubEnv("SEED_CATALOG", undefined);
    expect(requestedCatalog(["node", "seed.ts"])).toBe(undefined);
  });

  it("reads the process's own arguments by default", () => {
    vi.stubEnv("SEED_CATALOG", "from-env");
    expect(requestedCatalog()).toBe("from-env");
  });
});

describe("resolveCatalogDir", () => {
  beforeEach(() => {
    mkdirSync(join(root, "nist-800-53"));
    mkdirSync(join(root, "other"));
  });

  it("returns the catalog's directory", () => {
    expect(resolveCatalogDir(root, "nist-800-53")).toBe(
      join(root, "nist-800-53"),
    );
  });

  it("refuses to choose when no catalog is given, and lists the ones there are", () => {
    expect(() => resolveCatalogDir(root)).toThrow(
      "No catalog selected. Set SEED_CATALOG or pass --catalog=<name>. Available: nist-800-53, other",
    );
  });

  it("refuses a name that is a path rather than one directory", () => {
    for (const name of ["../nist-800-53", "a/b", ".hidden"]) {
      expect(() => resolveCatalogDir(root, name)).toThrow(
        /^Invalid catalog name/,
      );
    }
  });

  it("refuses a name that would land outside the seed root", () => {
    expect(() => resolveCatalogDir("relative/root", "nist-800-53")).toThrow(
      /resolves outside relative\/root/,
    );
  });

  it("names what is available when the catalog is unknown", () => {
    expect(() => resolveCatalogDir(root, "missing")).toThrow(
      'Unknown catalog "missing". Available: nist-800-53, other',
    );
    expect(() => resolveCatalogDir(join(root, "nist-800-53"), "x")).toThrow(
      "Available: (none found)",
    );
  });
});

describe("seedFilesIn", () => {
  it("returns the .sql files in the order they run", () => {
    for (const name of ["10-b.sql", "02-a.sql", "README.md", "00-c.sql"]) {
      writeFileSync(join(root, name), "");
    }
    expect(seedFilesIn(root)).toEqual(["00-c.sql", "02-a.sql", "10-b.sql"]);
  });

  it("sorts the files itself, whatever order the directory lists them in", () => {
    // Some filesystems list names already sorted, which would hide a missing sort.
    vi.mocked(readdirSync).mockReturnValueOnce([
      "10-b.sql",
      "README.md",
      "00-c.sql",
      "02-a.sql",
    ] as unknown as ReturnType<typeof readdirSync>);
    expect(seedFilesIn(root)).toEqual(["00-c.sql", "02-a.sql", "10-b.sql"]);
  });

  it("refuses a directory with nothing to seed", () => {
    writeFileSync(join(root, "README.md"), "");
    expect(() => seedFilesIn(root)).toThrow(
      `No .sql files in ${root} — nothing to seed.`,
    );
  });
});
