# Data Pipeline & Data Model

How control data gets from its sources into the database, and how the app derives what it displays. Read this before changing anything under `app/prisma/`.

## Mental model (start here)

The database is **seeded, not authored**. Sources feed generators that emit ordered SQL files; `app/prisma/seed.ts` runs every `seed-sql/<catalog>/*.sql` in alphabetical order through the `pg` driver, with the same loader the ECS seed task runs. To change the data you change a **source**, regenerate, and reseed. You never hand-edit rows.

**Seed SQL is per catalog.** One deployment holds one catalog, so a run is told which: `SEED_CATALOG=<name>` or `--catalog=<name>`, declared and never inferred. This repository's catalog is `nist-800-53/`, the stock NIST SP 800-53 Rev 5 catalog with its Zero Trust overlay, and every default (`make db-seed`, `yarn seed:generate`, `scripts/check-seed-sql.py`) points at it. A run that finds no `.sql` files fails rather than reporting a successful empty seed.

```
NIST OSCAL catalog + SP 800-53B profiles ─┐
previous release's catalog ───────────────┤
SP 800-53A assessment export ─────────────┴─► generators/catalog ► 00–08, 15, 16 ─┐
catalog back-matter ──► reference-links ─────────────────────────────► 10 ───┤
CISA ZTMM control mapping ─────────────────► generators/zt-overlay ► 09/11/13 ─┼─► loadSeed ► Postgres
hand-edited ZTMM guidance ───────────────────────────────────────────► 12 ───┤
mapped Zero Trust sources ────► zt-reference-links ──────────────────► 14 ───┘
```

Two ideas do the heavy lifting and recur throughout:

1. **Backbone + overlay.** The NIST catalog is the _backbone_: it defines the 1,014 live controls, their statements, discussion, parameters and baselines, and the 182 it has withdrawn, with where each one's content went. The Zero Trust mapping is an _overlay_: it maps the 345 controls CISA's mapping covers to pillars, functions and maturity stages, and is silent on the rest. That silence is kept: no mapping is written here for a control CISA's mapping leaves out, and the app says the mapping does not cover it. The overlay never changes catalog text.
2. **Two independent hierarchies that must never be conflated** (see next section).

## How a seed run behaves

**Every run replaces the catalog; nothing merges.** `00-cleanup.sql` truncates every catalog table, and each later file inserts into empty tables. The `ON CONFLICT … DO NOTHING` clauses in the generated files guard against a repeated key within one run. They never update a row from an earlier run, because no earlier rows survive the truncate. This is deliberate: the data belongs to its sources, so a reseed is a reload, not a migration.

- **Always run the whole seed.** Running one file against a seeded database bypasses the truncate, and `DO NOTHING` then keeps the old rows wherever a key already exists, silently. To change data, change the source, regenerate, and reseed in full.
- **Files commit one at a time, and a failure stops the run at that file.** Locally and on ECS, one loader (`loadSeed` in `seed-ecs.ts`) sends each file as one query, so a failing file rolls back on its own. The files before it stay loaded and the files after it never run, so the database holds a partial catalog until the next full run.
- **A failed run says how far it got.** The loader logs each file before running it, tagged `[seed]` locally and `[seed-ecs]` on ECS. On a failure it adds one `Partial seed:` line naming the files that loaded, the file that failed and the files that never ran, then the error itself (`[seed-ecs] Failed: <error>` on ECS), and the run exits 1. `make ecs-run-seed` and `make ecs-run-migrate` fail on a non-zero task exit, which also stops `make deploy` before it redeploys. A run that completed ends with `[seed] Completed <n> file(s)` or `[seed-ecs] Completed <n> file(s)`.
- **Recovery is another full run.** Fix the source or the generator, regenerate, and run the whole seed again. It starts by truncating, so a rerun after a failure is always safe.

**Deploying to an environment:** apply the schema first, then seed, then restart the app on it: `make ecs-run-migrate ENV=<env>`, `make ecs-run-seed ENV=<env>`, then `make ecs-redeploy ENV=<env>`. A seed against a schema that is behind the generated SQL fails at the first missing column, and the steps above apply. Runbook: [`ecs-migration-and-seed.md`](../runbooks/ecs-migration-and-seed.md).

## The two hierarchies (do not conflate)

The domain has two tree structures that share vocabulary ("a", "1", "sub-…") but are completely separate. Conflating them is the single biggest modeling trap.

**A — Control identity hierarchy** (`NistControl`)

- Base control → enhancement: `AC-02` → `AC-02(01)` → … via `parentControlId`.
- Defined entirely by the catalog. This is _which control you are looking at_.
- Owns: ZT mappings, parameters, the control's own statement tree.

**B — Statement-prose hierarchy** (`ControlPart`)

- A single control's statement broken into lettered/numbered items: `a.` → `1.` → `(a)` via `parentPartId`, scoped to one `nistControlId`.
- This is _the prose inside one control_, nothing more. The catalog writes it as nested parts, and the generator keeps NIST's markers as published.

> When you read "level", "nesting", or "depth" in pipeline code, confirm which hierarchy it means. A statement item's depth (letter/number/paren) is B and has nothing to do with base-vs-enhancement depth in A.

## Sources (provenance)

| Source                                              | Path                                                                                        | Owns (source of truth for)                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NIST OSCAL catalog and SP 800-53B baseline profiles | `app/prisma/sources/nist-800-53/` (pinned; see `SOURCE.md`)                                 | All 1,014 live controls and the identity hierarchy, statements, discussion, parameters, baselines and back-matter references; the 182 withdrawn controls and their successors |
| The previous release's NIST OSCAL catalog           | `app/prisma/sources/nist-800-53/NIST_SP-800-53_rev5.1.1_catalog-min.json` (pinned)          | The release delta: which controls this release added or dropped                                                                                                               |
| SP 800-53A assessment procedures                    | `app/prisma/sources/nist-800-53/cprt-SP_800_53_A_5_2_0.json`                                | Determination statements and examine / interview / test methods per control                                                                                                   |
| CISA's Zero Trust Maturity Model control mapping    | read from the published workbook into `app/prisma/sources/zt-mapping/cisa-ztmm-mapping.csv` | Which controls support which (pillar, function, maturity), designated Key, Supporting or Informative                                                                          |
| Hand-edited ZTMM guidance                           | `app/prisma/seed-sql/nist-800-53/12-ztmm-guidance-updated.sql`                              | The guidance _prose_ per (pillar, functionGroup) and maturity column                                                                                                          |
| Mapped Zero Trust sources                           | `app/prisma/sources/reference-links/cisa/sources.csv`                                       | Which Zero Trust documents each mapped control cites, in order                                                                                                                |

The overlay is CISA's mapping as published. Nothing leaves it except through `sources/zt-mapping/intentional-drops.csv`, with a reason, and the generator stops if any input row is unaccounted for. The CISA workbook is read where it sits and never committed; the transform keeps every row and column of it beside the canonical values, and records what looks wrong in it in `reports/zt-overlay/cisa-findings.csv` rather than correcting it.

## Where things live

Everything the pipeline reads, runs and writes is under `app/prisma/`, sorted by role:

| Folder                | Holds                                                                                                                                                                                                                                                   | Written by                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `sources/`            | Inputs, never generated by the pipeline: `nist-800-53/` (the pinned catalog, profiles and 800-53A export, with `SOURCE.md`), `zt-mapping/` (the Zero Trust mapping tables), `reference-links/<corpus>/` (live-check results, overrides, mapped sources) | a person, a retrieval step, or the CISA workbook transform |
| `generators/`         | Code and tests only: `catalog/`, `zt-overlay/`, `reference-links/`, `zt-reference-links/`, `shared/control-identifier/`                                                                                                                                 | a person                                                   |
| `reports/`            | What a generator reports about its run: `zt-overlay/` (tuples, CISA findings), `reference-links/<corpus>/` (registry, redirects)                                                                                                                        | the generators                                             |
| `seed-sql/<catalog>/` | The seed the loader runs, in file order                                                                                                                                                                                                                 | the generators                                             |

`schema.prisma`, `migrations/` and the seed runner (`seed.ts`, `seed-ecs.ts`, `catalog-dir.ts`, `seed-progress.ts`) stay at the top, where Prisma expects them.

## Transformations (the generators)

The NIST pipeline is deliberately standalone: it imports nothing from the other generators, and a test enforces it. They import from it instead: its expectations gate, ID scheme, parser and pin. See [`generate-nist-seed.md`](../scripts/generate-nist-seed.md).

### `generators/catalog/generate-seed.ts` (TypeScript) → `nist-800-53/00`–`08`, `15`, `16`

`yarn seed:generate`. Reads the pinned NIST SP 800-53 Rev 5 OSCAL JSON catalog and four SP 800-53B baseline profiles, and emits the backbone files below, plus `08`. The 1,014 live controls go to `04`; the 182 withdrawn go to `15`, and where each went, with the controls this release added since the previous one, to `16`. Inputs are verified by git blob SHA against a recorded pin, and the resolved source is stamped into every generated file. How withdrawn controls are modelled, what a source supplies for them and what a reader sees: [`withdrawn-controls.md`](./withdrawn-controls.md).

| File                           | Table                                     | Notes                                                                                                                                             |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-cleanup.sql`               | (truncate)                                | Wipes all tables for an idempotent reseed                                                                                                         |
| `01-system-user.sql`           | `User`                                    | System user for audit columns                                                                                                                     |
| `02-catalog-version.sql`       | `NistVersion`                             | NIST SP 800-53 Rev 5.2.0, marked active                                                                                                           |
| `03-control-families.sql`      | `ControlFamily`                           | 20 families                                                                                                                                       |
| `04-controls.sql`              | `NistControl`                             | 1,014 controls (300 base, 714 enhancements); carries `discussion` and baselines                                                                   |
| `05-parent-refs.sql`           | `NistControl.parentControlId`             | Wires the identity hierarchy (A)                                                                                                                  |
| `06-control-parts.sql`         | `ControlPart`                             | The statement-prose tree (B), 2,136 parts                                                                                                         |
| `07-control-parameters.sql`    | `ControlParameter`                        | Intentionally empty: NIST declares organization-defined parameters but assigns no values, so the placeholders are rendered into the prose in `06` |
| `08-assessment-procedures.sql` | `AssessmentObjective`, `AssessmentMethod` | See below                                                                                                                                         |
| `15-withdrawn-controls.sql`    | `NistControl` (status `WITHDRAWN`)        | 182 withdrawn controls (24 base, 158 enhancements): number, title and parent only, since the catalog carries nothing else for them                |
| `16-control-lineage.sql`       | `ControlLineage`                          | 203 rows: 166 incorporated into and 34 moved to a successor, and 3 controls added since 5.1.1+u4                                                  |

The same run reads the SP 800-53A Release 5.2.0 assessment procedures from the pinned CPRT export (a different publisher channel from `oscal-content`, SHA-256 verified) and writes `08-assessment-procedures.sql`: one `AssessmentObjective` row per determination statement, attached to its control and to the lettered `ControlPart` it assesses when there is one, and one `AssessmentMethod` row per examine / interview / test entry. Every control and statement the export names must resolve against what `04` and `06` seeded, or the run fails naming them.

Full flags, exit semantics and gotchas: [`generate-nist-seed.md`](../scripts/generate-nist-seed.md).

### `generators/reference-links/` (TypeScript) → `nist-800-53/10`

`make reference-links`. The catalog's own reference links, seeded at each resource's **current** address: a retrieval step probes every back-matter URL and commits the outcome (`sources/reference-links/nist-800-53/live.csv`), and an offline build step joins it to the catalog and a short override table of verified replacements to write `10-reference-links.sql`, with a `DataSource` row recording the retrieval that every link row points at, plus a registry and a redirect report under `reports/`. Why, and what the source sites publish: [`reference-links.md`](./reference-links.md); the procedure: [`refresh-reference-links.md`](../runbooks/refresh-reference-links.md).

### `generators/zt-overlay/` (TypeScript) → `09`/`11`/`13`

`make zt-overlay`. Folds the CISA mapping's rows into tuples, checks every row against `04` and `12`, and writes:

| File                         | Table               | Notes                                                                                                                                                              |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `09-zt-mappings.sql`         | `ZeroTrustMapping`  | One per mapped control. Holds a _representative_ pillars[]/function/maturity for the layer-cake card and the GIN filter: a tuple that resolves to a guidance group |
| `11-zt-part-coverage.sql`    | `ZTPartCoverage`    | Statement-item coverage. CISA's mapping is control-level and names no item, so the file has no rows                                                                |
| `13-zt-mapping-affinity.sql` | `ZTMappingAffinity` | **One row per real (pillar, function, maturity) tuple**. The representative in `09` is one of these                                                                |

`13` also carries CISA's designation and If Applicable flag on each tuple, which the modal shows. `reports/zt-overlay/tuples.csv` records every tuple's rows, designations and fate. `make zt-overlay-transform XLSX=<path>` re-reads a new edition of the CISA workbook. Both are deterministic, and a test fails if the committed seed differs from a fresh regeneration. README in the folder.

> **Workflow gotcha.** `11` validates part ids against `06`. After regenerating `06`, run `make zt-overlay` so `11` re-validates against the **new** `06`. Order: **`06` → `make zt-overlay` → reseed.** The generator stops, writing nothing, if a covered item no longer resolves.

### `generators/zt-reference-links/` (TypeScript) → `nist-800-53/14`

`make zt-reference-links`. The Zero Trust pane's references, mapped per control in `sources/reference-links/cisa/sources.csv` rather than cited by the catalog, seeded at each document's current address by the same retrieve-then-build shape: `14-zt-reference-links.sql` stores each document once as a `ReferenceLink` row (domain by publisher, kind `GUIDANCE`) and attaches it to each citing control through `NistControlLink` with the listed order, with its own `DataSource` row typed for that pane. README in the folder; the runbook above covers both corpora.

### Hand-maintained Zero Trust references → `nist-800-53/17`, `18`, `19`

No generator. CISA, NIST and OMB guidance cited at the page or section that addresses a control, one file per publisher (`17-zt-references-nist.sql`, `18-zt-references-cisa.sql`, `19-zt-references-omb.sql`), each its own source and edited directly under the contract in its header. They write the same two tables as `14`, plus a `DataSource` row each recording when the file's links were last checked; the pane reports the oldest of those dates. `make check-seed-links SEED_FILES=<file>` checks one file's links live. The acceptance rule and the way to add a row are in the `zt-reference-links` README.

### Hand-maintained FIPS 199 and FIPS 200 → `nist-800-53/20`

No generator. `20-fips.sql` seeds the two standards that put a system into a baseline, from the published PDFs, under the contract in its header: `FipsImpactLevel`, the three FIPS 199 potential impact levels with their definitions, and `Fips200Requirement`, the seventeen FIPS 200 minimum security requirement areas, one per control family that answers one (PM, PT and SR have none), each with a deep link to its page. Neither standard changes, so the rows are written once and edited directly. Nothing reads them yet; `make check-seed-links SEED_FILES=20-fips.sql` checks the links live, and `src/test/db/fips-seed.integration.test.ts` pins the rows.

### Why the file numbers

Files seed in alphabetical order. `12` (ZTMM guidance) is edited by hand and seeds after `09` because guidance resolves by **read-time natural key**, not a foreign key, so its order relative to `09` is free. `08` holds the assessment procedures. Slot `10` holds the catalog's own reference links, and `14` the Zero Trust pane's references, which seed after `13` and depend only on the control rows. The withdrawn controls (`15`) and the lineage (`16`) stay out of `04`, because the overlay checks every control it maps against `04` and a withdrawn control is never one to map. The hand-maintained Zero Trust references (`17` to `19`) seed after `14`, so each control's generated references come first and these follow. `20` (FIPS 199 and FIPS 200) depends only on the families in `03`. New seed files use whole-number prefixes (`21`, `22`, …), never subletters.

## Read-time derivation (follow-on data)

Several things the UI shows are **computed at query time** in `app/src/server/api/routers/decoder.ts`, not stored:

- **Control statement text**: composed from the `ControlPart` tree by `composeFromParts()`. There is no flat `controlStatement` column; the API's `description` field is derived.
- **Discussion**: `NistControl.discussion` is returned by `mapControl` and rendered as its own section in the modal's left pane, under the statement.
- **ZT guidance**: resolved per (pillar, functionGroup) and maturity column against `ZTMMGuidance` (the `12` data). When no group matches, the UI shows a neutral `ZT_GUIDANCE_PENDING` placeholder. `discussion` is **not** reused as the ZT fallback; it has its own section, and reusing it would show the same text twice.
- **Per-tuple guidance**: each `ZTMappingAffinity` tuple resolves its _own_ guidance, so a multi-pillar control shows one block per real tuple rather than one collapsed string. The modal groups them by pillar.
- **Layer-cake chip status**: `zero-trust-aligned` (the base control is mapped), `zt-aligned-with-enhancements` (the base and at least one enhancement are), `zt-via-enhancements` (only enhancements are) and `compliance` (nothing is; labelled "Not in CISA's mapping"), derived from which of the base control and its live enhancements have a `ZeroTrustMapping`.
- **Per-part ZT marker**: a `ControlPart` renders a teal "ZT enriched subcontrol" border when it has at least one `ZTPartCoverage` row (`_count.ztCoverages > 0`).
- **Control lineage**: `getControlById` returns `catalogStatus` (`live` or `withdrawn`; not `status`, which is Zero Trust alignment) and `lineage`: a withdrawn control's successors, flagging one that is a whole family and naming the item where the catalog names one; the withdrawn controls a live control took in; and the release that added a control new in this one. `lineage` is null when the catalog's data records no lineage at all, so the modal's one-line withdrawn notice says the successors are not recorded rather than that the catalog names none. Every read that lists controls (the layer cake and its roll-ups, search, the combined view) filters to live controls by default, so a withdrawn control is reached through the modal, as a tab under its live base or from the list of a control that took it in, or from search with "Search withdrawn controls" checked. The decisions and the reader's view: [`withdrawn-controls.md`](./withdrawn-controls.md).
- **Reference links**: `nistLinks` (from `NistLink`, the `10` data) fill the left pane with the references the catalog cites; `ztLinks` (`ReferenceLink` through `NistControlLink`, the `14` data and the hand-maintained `17` to `19`) fill the Zero Trust pane. Both are shown whether or not the control has a Zero Trust mapping.

## Current counts (NIST SP 800-53 Rev 5.2.0, verified 2026-10-28)

1,196 controls: 1,014 live (300 base, 714 enhancements) and 182 withdrawn (24 base, 158 enhancements) · 203 `ControlLineage` · 20 families · 2,136 `ControlPart` · 0 `ControlParameter` · 2,790 `AssessmentObjective` · 2,931 `AssessmentMethod` · 836 `NistLink` · 345 `ZeroTrustMapping` · 0 `ZTPartCoverage` · 36 `ZTMMGuidance` · 628 `ZTMappingAffinity` · 77 `ReferenceLink` (696 `NistControlLink` junctions: 604 from `14`, 92 from the hand-maintained `17` to `19`) · 3 `FipsImpactLevel` · 17 `Fips200Requirement`.

**Every control CISA maps exists in Rev 5.** `reports/zt-overlay/tuples.csv` has the breakdown per tuple.

**No item coverage:** CISA's mapping is control-level, so no statement item carries the per-item teal border.

## Deprecated / retired

| Item                                                                                                                         | State                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ZeroTrustMapping.implementationGuidance`                                                                                    | Dropped; the generator no longer emits it                                                                   |
| `ZTLink` (per-ZT-mapping links)                                                                                              | Replaced by `ReferenceLink` (control-level, `url`-unique, domain-tagged) and the `NistControlLink` junction |
| `ZeroTrustMapping.technicalControls`                                                                                         | Dropped (was all-null)                                                                                      |
| flat `controlStatement` field                                                                                                | Removed; the statement is composed from `ControlPart`                                                       |
| `Post` model                                                                                                                 | Legacy T3 scaffold; candidate for removal                                                                   |

## Related

- `app/prisma/schema.prisma`: the authoritative data model (per-model comments).
- `docs/runbooks/ecs-migration-and-seed.md`: running migrations and the seed against ECS.
