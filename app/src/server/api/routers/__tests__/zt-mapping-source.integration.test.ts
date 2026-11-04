/**
 * The Zero Trust mapping the app seeds is CISA's control mapping of its Zero
 * Trust Maturity Model, as published. Run against a real seeded Postgres through
 * the procedures the UI calls, so the controls below are checked as a reader
 * would meet them: on the layer cake and in the control modal.
 *
 * Each anchor is a kind of control the mapping must treat one way:
 *   AC-02      CISA maps it: the card stays, with CISA's tuples.
 *   AC-02(03)  CISA maps Access Management at Traditional, and only that.
 *   AC-06      CISA maps it: the card is there.
 *   AC-01      Mapped only to a Governance function, which CISA leaves out: no card.
 *   AU-05(02)  Mapped only to a capability standing alone, which CISA never uses: no card.
 * A change of source, or a tuple carried in from elsewhere, fails here rather
 * than showing up as a card nobody can trace to CISA's workbook.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import type { db as AppDb } from "~/server/db";
import { createTestDb } from "~/test/db/harness";

// The same stubs decoder.integration.test.ts explains: the router's import graph
// reaches ~/env and next-auth before the container's URL is known.
vi.mock("~/server/db", () => ({ db: {} }));
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
});
vi.mock("~/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

const db = createTestDb();
const caller = createCallerFactory(appRouter)({
  db: db as unknown as typeof AppDb,
  session: null,
  headers: new Headers(),
});

beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});

const tuples = (
  affinities: { pillar: string; function: string; maturity: string }[],
) =>
  affinities.map((a) => `${a.pillar} | ${a.function} | ${a.maturity}`).sort();

describe("the Zero Trust mapping follows CISA's control mapping", () => {
  it("keeps a control CISA maps, with CISA's tuple", async () => {
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-02" });
    expect(tuples(ctrl.ztMapping!.affinities)).toContain(
      "IDENTITY | Access Management | TRADITIONAL",
    );
  });

  it("carries the maturity CISA gives, and no other", async () => {
    const ctrl = await caller.decoder.getControlById({
      controlId: "AC-02(03)",
    });
    expect(tuples(ctrl.ztMapping!.affinities)).toEqual([
      "IDENTITY | Access Management | TRADITIONAL",
    ]);
  });

  it("maps a control CISA maps, on the cake and in the modal", async () => {
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-06" });
    expect(ctrl.ztMapping).toBeDefined();
    const { families } = await caller.decoder.getBridgeData();
    const chip = families
      .flatMap((f) => f.controls)
      .find((c) => c.id === "AC-06");
    expect(chip?.status).not.toBe("compliance");
  });

  it("gives a Governance-only control no card and no Zero Trust references", async () => {
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-01" });
    expect(ctrl.ztMapping).toBeUndefined();
    expect(ctrl.ztLinks).toEqual([]);
    const { families } = await caller.decoder.getBridgeData();
    const chip = families
      .flatMap((f) => f.controls)
      .find((c) => c.id === "AC-01");
    expect(chip?.status).toBe("compliance");
  });

  it("gives a control mapped only to a standalone capability no card", async () => {
    const ctrl = await caller.decoder.getControlById({
      controlId: "AU-05(02)",
    });
    expect(ctrl.ztMapping).toBeUndefined();
    expect(ctrl.ztLinks).toEqual([]);
  });

  it("carries CISA's designation on each tuple, the strongest where its rows differ", async () => {
    // CISA lists AC-06 under Access Management at Traditional twice, Supporting and Key.
    const ctrl = await caller.decoder.getControlById({ controlId: "AC-06" });
    expect(
      ctrl.ztMapping!.affinities.find(
        (a) =>
          a.pillar === "IDENTITY" &&
          a.function === "Access Management" &&
          a.maturity === "TRADITIONAL",
      ),
    ).toMatchObject({ designation: "KEY", ifApplicable: false });
    // The layer cake's designation filter reads the same tuples.
    const { families } = await caller.decoder.getBridgeData();
    expect(
      families.flatMap((f) => f.controls).find((c) => c.id === "AC-06")
        ?.designations,
    ).toContain("KEY");
    expect(
      await db.zTMappingAffinity.count({ where: { designation: null } }),
    ).toBe(0);
    expect(
      await db.zTMappingAffinity.count({ where: { ifApplicable: true } }),
    ).toBeGreaterThan(0);
  });

  it("seeds no Governance function, no standalone capability and no item coverage", async () => {
    expect(
      await db.zTMappingAffinity.count({
        where: {
          OR: [
            { pillar: "CROSS_CUTTING" },
            { function: { contains: "Governance" } },
          ],
        },
      }),
    ).toBe(0);
    expect(
      await db.zeroTrustMapping.count({
        where: { pillars: { has: "CROSS_CUTTING" } },
      }),
    ).toBe(0);
    expect(await db.zTPartCoverage.count()).toBe(0);
    // Not vacuous: the mapping itself is there.
    expect(await db.zTMappingAffinity.count()).toBeGreaterThan(0);
  });
});
