# Pinned NIST SP 800-53 Rev 5 inputs

Upstream: [`usnistgov/oscal-content`](https://github.com/usnistgov/oscal-content), path `nist.gov/SP800-53/rev5/json/`.

**Pin:** `78650f02ad9321bb7b817846f8fbd4f2bcd620de` (2026-05-13).

Catalog metadata at the pin: version `5.2.0`, OSCAL `1.2.2`. The 5.2.0 entry in the catalog's own revision history is dated 2025-08-26 — that is the publication date of the content; the file's `last-modified` is the date of its most recent re-serialization.

## Files and their git blob SHA-1

| File                                                 | Blob SHA-1                                 | Bytes     |
| ---------------------------------------------------- | ------------------------------------------ | --------- |
| `NIST_SP-800-53_rev5_catalog-min.json`               | `81c55f5c652bf2c6ccd5de0afe3ebe4618c6af91` | 4,906,119 |
| `NIST_SP-800-53_rev5_LOW-baseline_profile.json`      | `fe2ee0d4a982945479d1c2c61737302c35cfbec8` | 7,234     |
| `NIST_SP-800-53_rev5_MODERATE-baseline_profile.json` | `a5da8cff72abe52b819b69dbe225ad7c4d780c8e` | 10,498    |
| `NIST_SP-800-53_rev5_HIGH-baseline_profile.json`     | `05cbae1c0276f4fdff1f18cb3e521b13ac3ff9ea` | 12,492    |
| `NIST_SP-800-53_rev5_PRIVACY-baseline_profile.json`  | `85025c21e392ab4d67ad4b4490bbff6871811945` | 6,064     |

Verify any file with `git hash-object <file>`; the value is the same SHA-1 GitHub reports for the blob at the pin, so provenance can be checked without trusting the filename.

The readable catalog (10,442,037 bytes, blob `8ebe3c91181cc078d40e39bcf34ea233e652d025`) is **not** committed. A run fetches it at the pin and falls back to the minified copy here — see `fetch-inputs.ts`.

## Why JSON

All three published serializations carry identical content: 20 groups, 1,196 controls, 182 withdrawn, 1,600 parameters, 3,023 parameter placeholders, 530 hyperlinks. NIST's own readme states that the XML under `src/` is the authoring source but that the published copies, **in all three formats**, "should be considered to be the preferred reference versions" — so JSON carries no authority penalty where we actually read it.

JSON is the only form with a published JSON Schema (`oscal_catalog_schema.json`, released with each OSCAL version) for boundary validation. XML uniquely offers typed `<insert type="param">` elements instead of the `{{ insert: param, <id> }}` string convention, and nine XML comments of which seven mark what changed in 5.2.0 — neither is in JSON or YAML, and no JSON property marks a control as new or changed. Both are recoverable without an XML dependency: the placeholder convention is unambiguous and every one of the 3,023 round-trips, and a release changelog is better produced by diffing two pins than by parsing seven hand-written comments. YAML has no schema of its own and no content difference; it is JSON with worse validation.

## Moving the pin

Change the commit above and `PIN` and `EXPECTED_BLOB_SHA` in `app/prisma/generators/catalog/fetch-inputs.ts` together, re-download, record the new blob SHAs here, regenerate, and rebuild the reference links (`make reference-links-build`), whose provenance names this pin. The counts declared in `generate-seed.ts` are measured floors against this pin: if they fail after a pin move, that is the gate working — read the delta before widening a bound.

When the pin moves to a new release, the release it leaves becomes the previous release below, with `PREVIOUS_PIN`, `PREVIOUS_CATALOG` and `PREVIOUS_BLOB_SHA` in `fetch-inputs.ts` moved with it, so the delta stays one release wide.

## The previous release, for the release delta

**Pin:** `941c978d14c57379fbf6f7fb388f675067d5bff7` (2024-02-13), catalog version `5.1.1+u4`. The generator compares it with the catalog above, by OSCAL identifier, and seeds what was added and dropped as `ControlLineage` rows (`16-control-lineage.sql`). From 5.1.1 to 5.2.0 that is three controls added, `SA-15(13)`, `SA-24` and `SI-02(07)`, and none dropped, withdrawn or retitled.

| File                                          | Blob SHA-1                                 | Bytes     |
| --------------------------------------------- | ------------------------------------------ | --------- |
| `NIST_SP-800-53_rev5.1.1_catalog-min.json`    | `bf69d80e8e46d7c4f5c3d3b2aa37c48c01c5e816` | 4,878,039 |

The file is NIST's `NIST_SP-800-53_rev5_catalog-min.json` at that commit, renamed so it can sit beside the current one. It is only ever read from this committed copy; a run never fetches it.

The catalog was republished on 2026-10-22 (`5006f18c80`), still version `5.2.0` with no control added, dropped, withdrawn or retitled, so the pin above stands.

## SP 800-53A Release 5.2.0 assessment procedures (CPRT)

Upstream: NIST's Cybersecurity and Privacy Reference Tool (CPRT), framework version `SP_800_53_A_5_2_0`, at https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_A_5_2_0/home. This is a different distribution channel from `oscal-content`, which publishes the 800-53 catalog and its four baseline profiles and no assessment content.

| File                          | SHA-256                                                            | Bytes      |
| ----------------------------- | ------------------------------------------------------------------ | ---------- |
| `cprt-SP_800_53_A_5_2_0.json` | `82a0a904385c8954b80c3156ca6b36408b332597ec065cf706c3fbbbb26fb936` | 11,013,683 |

Retrieved 2026-09-16 from the export endpoint `https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/SP_800_53_A_5_2_0/export/json?element=all`, served as `cprt-SP_800_53_A_5_2_0-20260916-172115.json`. The committed copy uses the stable name above because the served filename carries a request timestamp.

### Why this pin is a committed copy rather than a fetch target

CPRT is a weaker upstream than a git commit in two specific ways. The served filename is request-stamped, so there is no immutable URL to pin the way `oscal-content` pins a blob at a commit; and the response carries `no-store`, so nothing about the endpoint promises that a later release serves the same bytes. Two fetches 45 seconds apart were byte-identical when this pin was taken, which is enough to pin by hash and not enough to trust blindly.

That makes the fallback matter more here than it does for the catalog, and it is not a reason to skip the fetch. `resolveCprtExport` fetches live, verifies against the SHA-256 above, and uses the committed copy when the fetch is unavailable or when it no longer matches. A mismatch **alerts** rather than falling back quietly, because a stale committed copy is otherwise indistinguishable from a current one and would keep seeding for as long as nobody re-downloaded by hand. The run still emits from the committed copy, so a changed upstream never changes this seed without someone deciding to move the pin, and the alert prints the new hash and the steps to adopt it. Nothing is written to disk by a fetch, so a run leaves no second copy of the export to be confused with the pinned one.

A committed copy that fails its own hash is fatal: there is nothing to fall back to, and a rewritten pinned input is exactly the case where "which input produced this seed" must not be answered with a guess.

The document record inside states version `5.2.0` and points at `NIST.SP.800-53Ar5.pdf`. The file uses CRLF line endings as served and is committed byte for byte; `app/.prettierignore` covers `prisma/sources/nist-800-53/`, and no line-ending normalization is applied to it, because the hash above is the provenance.

### Shape

The CPRT common schema, four flat arrays (`documents`, `elements`, `relationships`, `relationship_types`). At this pin: 13,591 elements (2,977 `determination`, 2,318 `control_statement`, 1,013 `examine`, 1,012 `interview`, 906 `test`, 872 `control_enhancement`, 324 `control`, 20 `family`, plus 1,465 `odp`, 1,465 `odp_statement`, 3 `odp_type`, 1,216 `sort`) and 19,077 relationships (15,550 `projection`, 3,527 `related`). All 1,196 control identifiers match the catalog's zero-padded labels, and every live `control_statement` maps onto exactly one seeded `ControlPart`.

### Known upstream defects at this pin

Each is declared by name in `assessment-parser.ts`, so a new one fails the run rather than joining them quietly. They are kept in two separate lists because they are two different problems.

**Unreachable determinations.** Four `determination` elements carry literal asterisks in their identifiers (`DS-IA-*[05]`, `DS-IA-*[06]`, `DS-IA-*(*)[01]`, `DS-IA-*(*)[02]`) and no control statement projects to them, so they cannot be attached to anything. They are counted and not emitted.

**Republished identifiers.** `IA-13_ODP[01]`, `IA-13_ODP[02]`, `OS-IA-13_odp[01]` and `OS-IA-13_odp[02]` each appear four times, byte-identical every time, so keeping the first loses nothing.

**Divergent identifiers.** `DS-IA-*(*)[01]` appears twice with *different* text: "The source of access tokens are verified before granting access…" and "assertions are generated in accordance with `<IA-*(*)_ODP policy>`". First-wins deduplication drops the second, which is a silent content loss rather than noise. Nothing ships wrong today only because that identifier is also unreachable and therefore never emitted — and a coincidence is not a safeguard, so the `divergent duplicates that were emitted` gate asserts that coupling on every run.
