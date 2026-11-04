/**
 * Proves the harness delivers a real, migrated, seeded Postgres — and
 * specifically that it came up through the migration folder, not a schema
 * push. Everything a later integration test relies on is asserted here once,
 * so a broken harness fails in one obvious place rather than as a dozen
 * confusing query failures downstream.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb } from "./harness";

const db = createTestDb();

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("integration harness", () => {
  it("applied the migration folder rather than pushing the schema", async () => {
    // Prisma cannot model an index access method, so `db push` produces a
    // B-tree here. Only replaying the migrations yields GIN — which is what the
    // `pillars: { has }` queries in the router depend on. This single assertion
    // is the difference between testing production's database and a look-alike.
    const rows = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'ZeroTrustMapping_pillars_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/USING gin/i);
  });

  it("has exactly one active catalog, and it is the pinned revision", async () => {
    // Every decoder procedure starts by resolving the active catalog; if this
    // is wrong or duplicated, nothing downstream means anything.
    const active = await db.nistVersion.findMany({ where: { isActive: true } });
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe("800-53r5.2.0");
    expect(active[0]!.catalogKey).toBe("nist-800-53-r5");
  });

  it("loaded the full control set", async () => {
    // 1,014 is the seed's own header count for 04-controls.sql and 182 the count
    // for 15-withdrawn-controls.sql: all 1,196 entries the catalog parses. A partial
    // load — the failure mode the generator gates exist for — shows up here as the
    // wrong number rather than as a green suite.
    expect(await db.nistControl.count({ where: { status: "LIVE" } })).toBe(
      1014,
    );
    expect(await db.nistControl.count({ where: { status: "WITHDRAWN" } })).toBe(
      182,
    );
    expect(await db.controlFamily.count()).toBe(20);
  });

  it("loaded the catalog's lineage", async () => {
    // 200 successors for the withdrawn controls (166 incorporated into, 34 moved to)
    // and the three controls 5.2.0 added since 5.1.1+u4, from 16-control-lineage.sql.
    expect(await db.controlLineage.count()).toBe(203);
    expect(await db.controlLineage.count({ where: { kind: "ADDED" } })).toBe(3);
    // Every successor but the one family (SA-12 went to SR) names a seeded control.
    expect(
      await db.controlLineage.count({
        where: {
          kind: { in: ["INCORPORATED_INTO", "MOVED_TO"] },
          relatedControlId: null,
        },
      }),
    ).toBe(1);
  });

  it("accepts a native enum-array predicate against the GIN index", async () => {
    // `pillars` is a Postgres `"ZTPillar"[]`, and this query is what the
    // router's pillar filter compiles to. With the overlay seeded the query has
    // to do more than plan and execute: it has to hand back the enum NAMES,
    // which is what the client's filter parsers key on. A wrong index access
    // method or a bad enum cast surfaces as ordinals, labels, or a throw.
    const row = await db.zeroTrustMapping.findFirst({
      where: { pillars: { has: "IDENTITY" } },
      select: { pillars: true },
    });
    expect(row).not.toBeNull();
    expect(row!.pillars).toContain("IDENTITY");
    // One mapping per control the overlay's affinity rows name: the seed is
    // whole, whatever edition of the mapping it came from.
    const tupleControls = await db.zTMappingAffinity.groupBy({
      by: ["ztMappingId"],
    });
    expect(tupleControls.length).toBeGreaterThan(0);
    expect(await db.zeroTrustMapping.count()).toBe(tupleControls.length);
  });
});
