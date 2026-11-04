/**
 * The server-side catalog boundary, through the real router.
 *
 * Two claims. Every procedure on the app router carries the boundary middleware,
 * asserted by enumerating the router rather than listing procedures, so one added
 * later is covered without anyone remembering. And each vector the boundary
 * exists for — a link URL, discussion prose, a baseline token — is shown to fail
 * with poisoned rows before the clean state is trusted; against the real seed two
 * of the three are vacuously clean, so a test without the poison proves nothing.
 *
 * Every rejection is awaited. An unawaited `rejects` only warns on this Vitest.
 */

import { vi } from "vitest";
import type { Mock } from "vitest";

interface MockDb {
  nistVersion: { findFirst: Mock };
  nistControl: { findFirst: Mock; findMany: Mock };
  zTMMGuidance: { findMany: Mock };
  dataSource: { findFirst: Mock };
  controlLineage: { findFirst: Mock };
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    nistVersion: { findFirst: vi.fn() },
    nistControl: { findFirst: vi.fn(), findMany: vi.fn() },
    zTMMGuidance: { findMany: vi.fn() },
    dataSource: { findFirst: vi.fn() },
    controlLineage: { findFirst: vi.fn() },
  } satisfies MockDb,
}));

vi.mock("~/server/db", () => ({ db: mockDb }));
vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { appRouter } from "~/server/api/root";
import { exportRouter } from "~/server/api/routers/decoder";
import { catalogBoundary, createCallerFactory } from "~/server/api/trpc";
import type { db } from "~/server/db";
import {
  ACTIVE_VERSION,
  makeControl,
  makeGuidance,
  makeParameter,
  makePart,
  makeZtMapping,
  poisonedBaseline,
  poisonedDiscussion,
  poisonedLink,
  poisonedReferenceLink,
} from "~/test/fixtures/decoder-rows";

const createCaller = createCallerFactory(appRouter);
function caller() {
  return createCaller({
    db: mockDb as unknown as typeof db,
    session: null,
    headers: new Headers(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
  mockDb.zTMMGuidance.findMany.mockResolvedValue([]);
  mockDb.dataSource.findFirst.mockResolvedValue(null);
  mockDb.controlLineage.findFirst.mockResolvedValue(null);
});

describe("every procedure carries the boundary", () => {
  // The routers' flat procedure records, keyed by dotted path: the app router and
  // the export's, which the file route calls and HTTP does not serve. Read from the
  // routers themselves so a new procedure is in the list the day it is added.
  type Composed = { _def: { middlewares: unknown[] } };
  const record = {
    ...appRouter._def.procedures,
    ...exportRouter._def.procedures,
  } as unknown as Record<string, Composed>;
  const procedures = Object.entries(record);
  const boundaryFns = catalogBoundary._middlewares as unknown[];

  it("has procedures to check", () => {
    expect(procedures.map(([name]) => name)).toContain(
      "decoder.getControlById",
    );
    expect(procedures.map(([name]) => name)).toContain(
      "export.getExportRecord",
    );
    expect(procedures.length).toBeGreaterThan(3);
  });

  it.each(procedures.map(([name]) => name))(
    "%s runs the catalog boundary",
    (name) => {
      const composed = record[name]!._def.middlewares;
      expect(boundaryFns.length).toBeGreaterThan(0);
      for (const fn of boundaryFns) expect(composed).toContain(fn);
    },
  );
});

describe("getControlById refuses each vector", () => {
  it("a reference link on the other product's host", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({ links: [poisonedLink()] }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    await expect(
      caller().decoder.getControlById({ controlId: "AC-01" }),
    ).rejects.toThrow(/nistLinks\[0\]\.url/);
  });

  it("a Zero Trust pane link on the other product's host", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({ referenceLinks: [poisonedReferenceLink()] }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    await expect(
      caller().decoder.getControlById({ controlId: "AC-01" }),
    ).rejects.toThrow(/ztLinks\[0\]\.url/);
  });

  it("discussion prose that names the other product", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({ discussion: poisonedDiscussion() }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    await expect(
      caller().decoder.getControlById({ controlId: "AC-01" }),
    ).rejects.toThrow(/served catalog vocabulary at discussion$/);
  });

  it("names where the vocabulary was, and keeps the text itself on the server", async () => {
    // The error message goes to the client unchanged, so the excerpt that
    // tripped the check must not ride inside the refusal; it is logged instead.
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({ discussion: poisonedDiscussion() }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    let message = "";
    try {
      await caller().decoder.getControlById({ controlId: "AC-01" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain(
      "decoder.getControlById served catalog vocabulary at discussion",
    );
    expect(message).not.toContain(poisonedBaseline());
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(poisonedBaseline()),
    );
    log.mockRestore();
  });

  it("a control-level baseline label the enum does not carry", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({ baselineLabels: ["Low", poisonedBaseline()] }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    await expect(
      caller().decoder.getControlById({ controlId: "AC-01" }),
    ).rejects.toThrow(/baselines\[1\]/);
  });

  it("a parameter value's baseline token", async () => {
    const part = makePart({
      parameters: [makeParameter({ low: "30 days", privacy: null })],
    });
    part.parameters[0]!.values.push({
      baselines: [poisonedBaseline()],
      value: "1 day",
    });
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({ parts: [part] }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    await expect(
      caller().decoder.getControlById({ controlId: "AC-01" }),
    ).rejects.toThrow(/parts\[0\]\.parameters\[0\]\.values\[\d+\]\.baselines/);
  });

  it("serves a clean control", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({
        discussion: "Establish and maintain the policy.",
        baselineLabels: ["Low", "Privacy"],
        parts: [makePart({ parameters: [makeParameter()] })],
      }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.id).toBe("AC-01");
  });
});

describe("the procedures that bypass mapControl", () => {
  it("getCombinedView refuses discussion prose, which it serves as guidance", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({ discussion: poisonedDiscussion() }),
    ]);
    await expect(caller().decoder.getCombinedView()).rejects.toThrow(
      /\[0\]\.guidance$/,
    );
  });

  it("getBridgeData refuses a control name", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({ controlName: `${poisonedBaseline()} Account Management` }),
    ]);
    await expect(caller().decoder.getBridgeData()).rejects.toThrow(
      /families\[0\]\.controls\[0\]\.name/,
    );
  });

  it("searchControls refuses a matched control's name", async () => {
    // Search serves number and name only; the name is its one text vector.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({ controlName: `${poisonedBaseline()} Account Management` }),
    ]);
    await expect(caller().decoder.searchControls({ q: "AC" })).rejects.toThrow(
      /hits\[0\]\.controlName/,
    );
  });
});

describe("ZTMM guidance, through the router", () => {
  it("is refused when it carries the vocabulary, like every other vector", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Identity Management",
        }),
      }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({ base: poisonedDiscussion() }),
    ]);
    await expect(
      caller().decoder.getControlById({ controlId: "AC-01" }),
    ).rejects.toThrow(/ztMapping\.guidance/);
  });
});
