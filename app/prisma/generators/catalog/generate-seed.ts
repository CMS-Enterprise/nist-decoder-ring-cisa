/**
 * Docs: docs/scripts/generate-nist-seed.md
 * NIST SP 800-53 Rev 5 → seed SQL.
 *
 * Usage:
 *   yarn seed:generate
 *   yarn seed:generate --offline               # skip the pinned fetch, use the committed copy
 *   yarn seed:generate --out-dir /tmp/x        # inspect a run before it touches tracked files
 *
 * Order is deliberate: read, parse, measure, GATE, then write. A run that falls
 * short leaves the previous seed on disk rather than replacing it with a thin one.
 *
 * The 1,014 live controls go to 04 and the files that hang off it. The 182 withdrawn
 * go to 15 with their status, so 04 keeps meaning the live catalog for everything that
 * reads it, and where each withdrawn control went goes to 16 as lineage, with the
 * controls this release added or dropped against the previous one (see SOURCE.md).
 *
 * The SP 800-53A assessment procedures ride the same run: read from the pinned
 * CPRT export, resolved against the controls and parts parsed above, gated with
 * the rest, and written as 08 after the rows they reference.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PIN,
  PREVIOUS_PIN,
  cprtProvenanceLine,
  provenanceLine,
  readPreviousCatalog,
  resolveCprtExport,
  readProfile,
  resolveCatalog,
  type ResolvedInput,
} from "./fetch-inputs.js";
import {
  catalogEntries,
  releaseDelta,
  withdrawalLineage,
  withdrawnWithoutParent,
} from "./lineage.js";
import {
  KNOWN_DIVERGENT_DUPLICATES,
  KNOWN_IDENTICAL_DUPLICATES,
  KNOWN_ORPHAN_DETERMINATIONS,
  indexExport,
  readAssessmentContent,
} from "./assessment-parser.js";
import {
  assertExpectations,
  ExpectationError,
  formatExpectations,
  type Expectation,
} from "./expectations.js";
import { integrityExpectations, measureIntegrity } from "./integrity.js";
import { buildParamIndex } from "./parameter-resolver.js";
import {
  catalogControlIds,
  parseControls,
  parseFamilies,
} from "./oscal-parser.js";
import {
  BASELINE_NAMES,
  baselineNameFor,
  baselinesFromProfiles,
  type BaselineProfile,
} from "./profile-parser.js";
import {
  nistIdScheme,
  objectiveId,
  writeAssessmentProceduresSql,
  writeCatalogVersionSql,
  writeCleanupSql,
  writeControlFamiliesSql,
  writeControlPartsSql,
  writeControlParametersSql,
  writeControlsSql,
  writeLineageSql,
  writeParentRefsSql,
  writeSystemUserSql,
  writeWithdrawnControlsSql,
} from "./sql-writer.js";
import type {
  CprtExport,
  OscalCatalog,
  OscalProfile,
  ParsedControl,
} from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "../../sources/nist-800-53");
const DEFAULT_OUT = resolve(HERE, "../../seed-sql/nist-800-53");

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function countParts(controls: ParsedControl[]): number {
  let n = 0;
  const walk = (parts: ParsedControl["statementParts"]): void => {
    for (const p of parts) {
      n++;
      walk(p.children);
    }
  };
  for (const c of controls) walk(c.statementParts);
  return n;
}

/** The release date of the content: the revision entry matching the catalog's
 *  own version. Falls back to the file's last-modified, which is the date of its
 *  most recent re-serialization rather than of the content. */
function releaseDate(catalog: OscalCatalog): string {
  const meta = catalog.catalog.metadata;
  const match = meta.revisions?.find((r) => r.version === meta.version);
  const stamp = match?.["last-modified"] ?? meta["last-modified"];
  return new Date(stamp).toISOString();
}

async function main(): Promise<void> {
  const outputDir = option("out-dir") ?? DEFAULT_OUT;
  const offline = flag("offline");

  console.log(`NIST SP 800-53 Rev 5 seed generator`);
  console.log(`Pin:    oscal-content ${PIN}`);
  console.log(`Output: ${outputDir}\n`);

  // ---- read -------------------------------------------------------------------
  const catalogInput = await resolveCatalog(DATA_DIR, { offline });
  console.log(`  ${provenanceLine(catalogInput)}`);
  const catalog = JSON.parse(
    catalogInput.content.toString("utf8"),
  ) as OscalCatalog;

  const profileInputs: ResolvedInput[] = BASELINE_NAMES.map((n) =>
    readProfile(
      DATA_DIR,
      `NIST_SP-800-53_rev5_${n.toUpperCase()}-baseline_profile.json`,
    ),
  );
  const profiles: BaselineProfile[] = profileInputs.map((input) => {
    const profile = JSON.parse(input.content.toString("utf8")) as OscalProfile;
    return {
      name: baselineNameFor(input.name, profile),
      profile,
      source: input.name,
    };
  });

  const meta = catalog.catalog.metadata;
  const scheme = nistIdScheme(meta.version);
  console.log(
    `  Catalog ${meta.title} v${meta.version} (OSCAL ${meta["oscal-version"]})\n`,
  );

  // ---- parse ------------------------------------------------------------------
  const membership = baselinesFromProfiles(
    profiles,
    catalogControlIds(catalog),
  );
  for (const u of membership.unresolved) {
    console.warn(
      `  WARNING: ${u.baseline} lists ${u.id}, which the catalog does not define`,
    );
  }

  const families = parseFamilies(catalog);
  const { controls: all, resolutions } = parseControls(
    catalog,
    membership.byControl,
    buildParamIndex(catalog),
  );

  const withdrawn = all.filter((c) => c.withdrawal);
  const live = all.filter((c) => !c.withdrawal);
  const base = live.filter((c) => c.parentOscalId === null);
  const enhancements = live.filter((c) => c.parentOscalId !== null);

  // ---- lineage ------------------------------------------------------------------
  // Where each withdrawn control went, from its own links, and what this release added or
  // dropped against the previous one, from the two pinned catalogs.
  const succession = withdrawalLineage(all, families, meta.version);
  const previousInput = readPreviousCatalog(DATA_DIR);
  const previous = JSON.parse(
    previousInput.content.toString("utf8"),
  ) as OscalCatalog;
  const previousVersion = previous.catalog.metadata.version;
  const delta = releaseDelta(
    catalogEntries(previous),
    catalogEntries(catalog),
    previousVersion,
    meta.version,
  );

  console.log(`  families            ${families.length}`);
  console.log(`  controls parsed     ${all.length}`);
  console.log(`  withdrawn           ${withdrawn.length}`);
  console.log(
    `  successors          ${succession.rows.length} (${succession.multiSuccessor.length} controls with several, ${succession.withoutSuccessor.length} with none)`,
  );
  console.log(
    `  since ${previousVersion.padEnd(12)} ${delta.added.length} added (${delta.added.join(", ")}), ${delta.dropped.length} dropped, ${delta.newlyWithdrawn.length} newly withdrawn`,
  );
  console.log(
    `  live                ${live.length}  (${base.length} base, ${enhancements.length} enhancements)`,
  );
  console.log(`  statement parts     ${countParts(live)}`);
  console.log(
    `  baseline ids        ${membership.listed} listed, ${membership.listed - membership.unresolved.length} resolved`,
  );

  const unresolvedPlaceholders = resolutions.filter((r) => r.rendered === null);
  console.log(
    `  placeholders        ${resolutions.length - unresolvedPlaceholders.length} rendered, ` +
      `${unresolvedPlaceholders.length} unresolved, ` +
      `${resolutions.filter((r) => r.resolvedFrom).length} declared on another control\n`,
  );
  for (const u of unresolvedPlaceholders) {
    console.warn(
      `  WARNING: unresolved placeholder ${u.paramId} in ${u.controlId}`,
    );
  }

  // ---- assessment procedures (SP 800-53A, via CPRT) ------------------------------
  // Read after the catalog so every control and statement the export names can be checked against what was actually parsed. A miss throws with the offender named; nothing about assessment content is inferred.
  const cprtInput = await resolveCprtExport(DATA_DIR, { offline });
  console.log(`  ${cprtProvenanceLine(cprtInput)}`);
  const cprt = indexExport(
    JSON.parse(cprtInput.content.toString("utf8")) as CprtExport,
  );
  const assessment = readAssessmentContent(cprt, live, withdrawn);
  const m = assessment.measured;
  const unresolvedOdp = assessment.odpResolutions.filter(
    (r) => r.rendered === null,
  );
  const unexpectedOrphans = m.determinationsOrphaned.filter(
    (id) => !KNOWN_ORPHAN_DETERMINATIONS.has(id),
  );
  const unexpectedIdenticalDuplicates = m.duplicatesIdentical.filter(
    (id) => !KNOWN_IDENTICAL_DUPLICATES.has(id),
  );
  const unexpectedDivergentDuplicates = m.duplicatesDivergent.filter(
    (id) => !KNOWN_DIVERGENT_DUPLICATES.has(id),
  );
  const objectiveIds = new Set(
    assessment.objectives.map((o) =>
      objectiveId(o.cprtIdentifier, scheme.token),
    ),
  );
  const methodCount = (kind: "EXAMINE" | "INTERVIEW" | "TEST"): number =>
    assessment.methods.filter((x) => x.method === kind).length;
  console.log(
    `  assessment          ${assessment.objectives.length} determinations on ${m.controlsLive} of ${m.catalogLive} live controls ` +
      `(${m.controlsWithdrawn} withdrawn skipped, ${m.controlsMissingFromExport.length} absent from the export)`,
  );
  console.log(
    `  methods             examine ${methodCount("EXAMINE")}, interview ${methodCount("INTERVIEW")}, test ${methodCount("TEST")}`,
  );
  console.log(
    `  method gaps         no examine ${m.controlsWithoutMethod.EXAMINE.length}, no interview ${m.controlsWithoutMethod.INTERVIEW.length}, no test ${m.controlsWithoutMethod.TEST.length}, none at all ${m.controlsWithoutAnyMethod.length}`,
  );
  console.log(
    `  odp references      ${assessment.odpResolutions.length - unresolvedOdp.length} rendered, ${unresolvedOdp.length} unresolved\n`,
  );

  // ---- gate -------------------------------------------------------------------
  // Measured against the pinned catalog. Floors sit a little under the actuals so
  // an upstream edit does not fail the build, but a collapse does. The withdrawn
  // count carries a ceiling because its failure mode is the skip growing.
  const expectations: Expectation[] = [
    { name: "families", actual: families.length, floor: 20 },
    { name: "controls parsed", actual: all.length, floor: 1190 },
    {
      name: "withdrawn controls",
      actual: withdrawn.length,
      floor: 180,
      ceiling: 200,
      because:
        "Rev 5.2.0 withdraws 182 controls; each is written with status WITHDRAWN (15) and its successors as lineage (16)",
    },
    { name: "live controls", actual: live.length, floor: 1000 },
    { name: "live base controls", actual: base.length, floor: 295 },
    { name: "live enhancements", actual: enhancements.length, floor: 700 },
    { name: "statement parts", actual: countParts(live), floor: 2100 },
    {
      name: "baseline ids resolved",
      actual: membership.listed - membership.unresolved.length,
      floor: membership.listed,
      because:
        "every id a baseline profile lists must name a control the catalog defines; a miss means catalog and profiles are out of step",
    },
    {
      name: "unresolved placeholders",
      actual: unresolvedPlaceholders.length,
      floor: 0,
      ceiling: 0,
      because:
        "a placeholder left in the prose would ship literal {{ insert: param }} markup to a reader",
    },
  ];
  console.log(formatExpectations("nist", expectations));
  assertExpectations("nist", expectations);

  // Measured against the CPRT export at its pin: 2,790 determinations across all 1,014 live controls, 1,013 examine / 1,012 interview / 906 test entries, 1,743 ODP references. The floors sit under the actuals; the zero-ceilings are the joins that must hold exactly.
  //
  // Every count below is denominated in the CATALOG. A gate whose denominator came from the export can only say that everything the export mentioned was handled, which is not the claim worth making: the failure that matters is the export naming LESS than the catalog needs, and that failure moves an export-denominated count and its floor in the same direction, so it clears.
  const assessmentExpectations: Expectation[] = [
    {
      name: "catalog controls absent from the export",
      actual: m.controlsMissingFromExport.length,
      floor: 0,
      ceiling: 0,
      because: `every live control the catalog defines must receive assessment content; a control the export stops naming emits no rows while every export-derived count still balances${
        m.controlsMissingFromExport.length
          ? `: ${m.controlsMissingFromExport.slice(0, 10).join(", ")}`
          : ""
      }`,
    },
    {
      name: "determination statements",
      actual: assessment.objectives.length,
      floor: 2700,
    },
    {
      name: "controls with no determination",
      actual: m.controlsWithoutObjectives.length,
      floor: 0,
      ceiling: 0,
      because: `every live control in SP 800-53A carries at least one determination${
        m.controlsWithoutObjectives.length
          ? `: ${m.controlsWithoutObjectives.slice(0, 10).join(", ")}`
          : ""
      }`,
    },
    {
      name: "assessment method entries",
      actual: assessment.methods.length,
      floor: 2850,
    },
    // Per kind rather than in total. NIST's gaps are specific and uneven, and a single "controls with no method" count would describe 108 test absences as missing assessment content, which is false for controls that carry both of the other two.
    {
      name: "controls with no examine method",
      actual: m.controlsWithoutMethod.EXAMINE.length,
      floor: 0,
      ceiling: 5,
      because: `PM-12 alone at the pin; examine is the near-universal method, so a rise means the export changed shape${
        m.controlsWithoutMethod.EXAMINE.length
          ? `: ${m.controlsWithoutMethod.EXAMINE.join(", ")}`
          : ""
      }`,
    },
    {
      name: "controls with no interview method",
      actual: m.controlsWithoutMethod.INTERVIEW.length,
      floor: 0,
      ceiling: 5,
      because: `CM-03(08) and SA-10(04) at the pin${
        m.controlsWithoutMethod.INTERVIEW.length
          ? `: ${m.controlsWithoutMethod.INTERVIEW.join(", ")}`
          : ""
      }`,
    },
    {
      name: "controls with no test method",
      actual: m.controlsWithoutMethod.TEST.length,
      floor: 0,
      ceiling: 130,
      because:
        "108 live controls at the pin, mostly policy and procedure controls, carry examine and interview but have nothing to test technically",
    },
    {
      name: "controls with no method at all",
      actual: m.controlsWithoutAnyMethod.length,
      floor: 0,
      ceiling: 0,
      because: `every live control carries at least one method kind; a control with none is an ingest failure rather than a gap in the publication${
        m.controlsWithoutAnyMethod.length
          ? `: ${m.controlsWithoutAnyMethod.slice(0, 10).join(", ")}`
          : ""
      }`,
    },
    {
      name: "statements resolved to a seeded part",
      actual: m.statementsResolved,
      floor: m.statementsLive,
      because:
        "every control statement the export names must be a part the catalog seeded; a miss would attach a determination to nothing",
    },
    {
      name: "relationship endpoints naming no element",
      actual: m.danglingEndpoints.length,
      floor: 0,
      ceiling: 0,
      because: `a projection pointing at an element the export does not contain is a hole in the input, and the type-filtered reads would drop it silently${
        m.danglingEndpoints.length
          ? `: ${m.danglingEndpoints.slice(0, 10).join(", ")}`
          : ""
      }`,
    },
    {
      name: "orphaned determinations outside the known set",
      actual: unexpectedOrphans.length,
      floor: 0,
      ceiling: 0,
      because: `a determination no control statement projects to cannot be attached; the four with asterisk identifiers are declared${
        unexpectedOrphans.length ? `: ${unexpectedOrphans.join(", ")}` : ""
      }`,
    },
    {
      name: "republished identifiers outside the known set",
      actual: unexpectedIdenticalDuplicates.length,
      floor: 0,
      ceiling: 0,
      because: `the export republishes the four IA-13 parameter elements byte-identically, where keeping the first loses nothing; anything else repeated is a new upstream defect${
        unexpectedIdenticalDuplicates.length
          ? `: ${unexpectedIdenticalDuplicates.join(", ")}`
          : ""
      }`,
    },
    {
      name: "divergent duplicates outside the known set",
      actual: unexpectedDivergentDuplicates.length,
      floor: 0,
      ceiling: 0,
      because: `one identifier carrying two different texts means first-wins dropped content; DS-IA-*(*)[01] is the one declared at the pin${
        unexpectedDivergentDuplicates.length
          ? `: ${unexpectedDivergentDuplicates.join(", ")}`
          : ""
      }`,
    },
    {
      name: "divergent duplicates that were emitted",
      actual: m.divergentDuplicatesEmitted.length,
      floor: 0,
      ceiling: 0,
      because: `a divergent duplicate is harmless only while nothing it names is written; the declared one is also unreachable, and this asserts that coupling rather than relying on it${
        m.divergentDuplicatesEmitted.length
          ? `: ${m.divergentDuplicatesEmitted.join(", ")}`
          : ""
      }`,
    },
    {
      name: "odp references rendered",
      actual: assessment.odpResolutions.length,
      floor: 1700,
      because:
        "floored on the count itself, not only on its failures: zero unresolved cannot tell all 1,743 resolved from the pattern having stopped matching",
    },
    {
      name: "unresolved odp references",
      actual: unresolvedOdp.length,
      floor: 0,
      ceiling: 0,
      because:
        "an ODP reference left in a determination would ship literal <XX-00_ODP[00] ...> markup to a reader",
    },
    {
      name: "duplicate objective ids",
      actual: assessment.objectives.length - objectiveIds.size,
      floor: 0,
      ceiling: 0,
      because:
        "two determinations mapping onto one row id would violate the AssessmentObjective primary key",
    },
  ];
  console.log(
    `\n${formatExpectations("nist assessment", assessmentExpectations)}`,
  );
  assertExpectations("nist assessment", assessmentExpectations);

  const integrity = integrityExpectations(measureIntegrity(live));
  console.log(`\n${formatExpectations("nist integrity", integrity)}`);
  assertExpectations("nist integrity", integrity);

  const orphans = withdrawnWithoutParent(withdrawn, all);
  // Measured against the two pins: 200 successors for the 180 withdrawn controls that name
  // one, eleven of them with several; one successor is a statement part (AC-02(10) went to
  // AC-02 item k) and one a whole family (SA-12 went to SR); and 5.1.1+u4 to 5.2.0 adds three
  // controls and drops none.
  const lineageExpectations: Expectation[] = [
    {
      name: "successor rows",
      actual: succession.rows.length,
      floor: 195,
    },
    {
      name: "withdrawn controls with several successors",
      actual: succession.multiSuccessor.length,
      floor: 11,
      ceiling: 11,
      because: `each of the eleven must carry every successor it names; a change in the count means the parse or the catalog moved${
        succession.multiSuccessor.length !== 11
          ? `: ${succession.multiSuccessor.join(", ")}`
          : ""
      }`,
    },
    {
      name: "successors naming nothing in the catalog",
      actual: succession.unresolved.length,
      floor: 0,
      ceiling: 0,
      because: `a successor must be a control, a statement part or a family the catalog defines${
        succession.unresolved.length
          ? `: ${succession.unresolved.join(", ")}`
          : ""
      }`,
    },
    {
      name: "withdrawn controls with no successor",
      actual: succession.withoutSuccessor.length,
      floor: 0,
      ceiling: 2,
      because: `CP-10(03) and SC-19 at the pin${
        succession.withoutSuccessor.length > 2
          ? `: ${succession.withoutSuccessor.join(", ")}`
          : ""
      }`,
    },
    {
      name: "successors resolved through a statement part",
      actual: succession.viaPart.length,
      floor: 0,
      ceiling: 1,
      because: `AC-02(10) -> ac-2_smt.k at the pin, recorded as AC-02${
        succession.viaPart.length > 1
          ? `: ${succession.viaPart.join(", ")}`
          : ""
      }`,
    },
    {
      name: "successors that are themselves withdrawn",
      actual: succession.toWithdrawn.length,
      floor: 0,
      ceiling: 0,
      because: `every chain from a withdrawn control ends one step away, at a live control, a family or nothing${
        succession.toWithdrawn.length > 0
          ? `: ${succession.toWithdrawn.join(", ")}`
          : ""
      }`,
    },
    {
      name: "withdrawn enhancements whose parent the catalog lacks",
      actual: orphans.length,
      floor: 0,
      ceiling: 0,
      because: `15 sets each one's parent, so every parent must be seeded${
        orphans.length > 0 ? `: ${orphans.join(", ")}` : ""
      }`,
    },
    {
      name: "successors that are a whole family",
      actual: succession.viaFamily.length,
      floor: 0,
      ceiling: 1,
      because: `SA-12 -> sr at the pin, recorded as SR with no foreign key${
        succession.viaFamily.length > 1
          ? `: ${succession.viaFamily.join(", ")}`
          : ""
      }`,
    },
    {
      name: `controls added since ${previousVersion}`,
      actual: delta.added.length,
      floor: 3,
      ceiling: 3,
      because: `5.2.0 adds SA-15(13), SA-24 and SI-02(07); measured at both pins, so moving either is read here first${
        delta.added.length !== 3 ? `: ${delta.added.join(", ")}` : ""
      }`,
    },
    {
      name: `controls dropped since ${previousVersion}`,
      actual: delta.dropped.length,
      floor: 0,
      ceiling: 0,
      because: `a release withdraws a control rather than deleting it${
        delta.dropped.length ? `: ${delta.dropped.join(", ")}` : ""
      }`,
    },
  ];
  console.log(`\n${formatExpectations("nist lineage", lineageExpectations)}`);
  assertExpectations("nist lineage", lineageExpectations);

  // ---- write ------------------------------------------------------------------
  // Stamped into every file so the artifact answers "which input produced this".
  const note = provenanceLine(catalogInput);

  writeCleanupSql(outputDir, note);
  writeSystemUserSql(outputDir, note);
  writeCatalogVersionSql(
    outputDir,
    {
      version: `800-53r${meta.version}`,
      catalogKey: `nist-800-53-r${meta.version.split(".")[0]}`,
      displayLabel: `NIST SP 800-53 Rev ${meta.version.split(".")[0]}`,
      upstreamRevision: `NIST SP 800-53 Rev ${meta.version}`,
      // A stock catalog applies no tailoring. The null is the meaning.
      tailoringNote: null,
      releaseDate: releaseDate(catalog),
      description: meta.title,
    },
    scheme,
    note,
  );
  writeControlFamiliesSql(outputDir, families, note);
  writeControlsSql(outputDir, live, scheme, note);
  writeParentRefsSql(outputDir, live, scheme, note);
  writeControlPartsSql(outputDir, live, scheme, note);
  writeControlParametersSql(outputDir, note);
  writeAssessmentProceduresSql(
    outputDir,
    assessment.objectives,
    assessment.methods,
    {
      liveControls: m.catalogLive,
      missing: m.controlsWithoutMethod,
      withoutAny: m.controlsWithoutAnyMethod,
    },
    scheme,
    cprtProvenanceLine(cprtInput),
  );
  writeWithdrawnControlsSql(outputDir, withdrawn, all, scheme, note);
  writeLineageSql(
    outputDir,
    [...succession.rows, ...delta.rows],
    new Set(all.map((c) => c.controlNumber)),
    scheme,
    `${note}\n-- release delta against ${previousVersion}: oscal-content ${PREVIOUS_PIN}`,
  );

  console.log(
    `\n  wrote 00-cleanup, 01-system-user, 02-catalog-version, 03-control-families,`,
  );
  console.log(
    `        04-controls, 05-parent-refs, 06-control-parts, 07-control-parameters,`,
  );
  console.log(
    `        08-assessment-procedures, 15-withdrawn-controls, 16-control-lineage`,
  );
  console.log(`\nDone.`);
}

main().catch((err: unknown) => {
  if (err instanceof ExpectationError) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
  throw err;
});
