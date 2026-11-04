# Withdrawn controls

A catalog revises itself by withdrawing controls as well as by adding them. A withdrawn control keeps its number and title, loses its statement, and usually names where its content went. This page records how a withdrawn control reaches the app, the decisions behind the model, what any source dataset has to supply for it, and what a reader sees. The generator's commands and gates are `docs/scripts/generate-nist-seed.md`; where the seed files sit among the others is `docs/architecture/data-pipeline.md`.

## Decisions

1. **Status is a property of the control.** `NistControl.status` is `LIVE` or `WITHDRAWN` and defaults to `LIVE`. Every row seeded before the column existed keeps its meaning, and a catalog that records no status is entirely live without any change to its pipeline.
2. **Lineage is a table, keyed by control number, with foreign keys optional.** A withdrawn control can have several successors (eleven do at the current pin), a successor can be a whole family or one item of another control's statement, and a release delta can name a control the seeded release does not carry. A natural key keeps each of those rows truthful when there is nothing for a foreign key to point at; the keys are set wherever the related row is seeded.
3. **Current controls are the default, and withdrawn ones are reached on purpose.** Every read that lists controls (the layer cake and its roll-ups, the filters, the combined view, search) returns live controls only, so the counts and the diagram describe the catalog as it stands. A withdrawn control is reached from the modal, as a tab under its base or from the control that took its content, or from search with "Search withdrawn controls" switched on.
4. **Withdrawn controls seed last, in files of their own.** They go to `15-withdrawn-controls.sql` and their lineage to `16-control-lineage.sql`, never to `04-controls.sql`. The Zero Trust overlay checks every row it maps against `04`, and a withdrawn control is never one to map. Files `01` to `14` are unchanged by withdrawn controls existing.
5. **Absent at source is not the same as never ingested.** When the catalog's data records no lineage at all, the API sends `lineage: null` and a withdrawn control says its successors are not recorded. When lineage is recorded and a control simply has no successor, it says the catalog names none. A reader is never told the catalog said something it did not.
6. **The vocabulary is the catalog's own, and names no catalog.** Withdrawn, incorporated into, moved to and new in a release are terms OSCAL catalogs share, so none of it takes a product slot, and the same components render any catalog's withdrawn controls.
7. **A release delta records additions and drops only.** It compares two pinned catalogs by OSCAL identifier. A change to a live control's text between releases is not recorded.
8. **Every chain from a withdrawn control ends one step away.** A successor is a live control, a family, or nothing. A successor that is itself withdrawn fails the generator, so following a link from a withdrawn control always lands somewhere current: a live control (on the item, when the catalog names one), the layer cake filtered to a family, or a notice that the catalog names no successor.

## The model

`NistControl.status` carries the status. `ControlLineage` carries one row per relation the catalog records:

| Column                                           | Meaning                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `controlNumber`                                  | The control the row is about, e.g. `AC-02(10)`                                                                                        |
| `kind`                                           | `INCORPORATED_INTO` or `MOVED_TO` for a successor; `ADDED` or `DROPPED` for a release delta                                           |
| `relatedControlNumber`                           | The successor: a control number, or a family code such as `SR` where the catalog names a whole family. Null for `ADDED` and `DROPPED` |
| `relatedPartOscalId`                             | The successor's item, where the catalog names one item of a statement rather than the whole control, e.g. `ac-2_smt.k`                |
| `release`                                        | The release that records the row, e.g. `5.2.0`                                                                                        |
| `sinceRelease`                                   | The release compared against, for `ADDED` and `DROPPED`, e.g. `5.1.1+u4`                                                              |
| `controlId`, `relatedControlId`, `relatedPartId` | Foreign keys to the control, the successor and the successor's item, set when that row is seeded                                      |

`getControlById` serves any control, withdrawn included, with `catalogStatus` (`live` or `withdrawn`; not `status`, which says whether a control is Zero Trust aligned) and `lineage`: the successors, each with its item and its Zero Trust pillars when it is mapped, the withdrawn controls a live control took in, and the release that added a control new in this one. Its enhancements come back in catalog order with the withdrawn ones in place. `searchControls` takes `includeWithdrawn`, off by default.

## Bringing in a catalog

The model asks a source for three things, each optional beyond the first, and the app degrades to what was supplied.

- **A status per control.** The minimum. A withdrawn control is seeded with status `WITHDRAWN`, its number, title and parent, and renders in the grey withdrawn box. With nothing more, the box reads "Successors not recorded for this catalog."
- **Successor links.** One `INCORPORATED_INTO` or `MOVED_TO` row per successor, naming a control, an item of a control's statement, or a family. The box then names each successor and opens it.
- **A previous release, pinned.** Compared by identifier, it yields `ADDED` and `DROPPED` rows, and a control new in the current release carries a marker.

An OSCAL catalog states the first two in its own vocabulary: a `status` property of `withdrawn` on the control, and links with `rel` of `incorporated-into` or `moved-to` whose `href` names the successor. The catalog generator reads exactly those, so any OSCAL catalog that uses them needs no new code, and its gates fail a run on a successor that names nothing in the catalog. A source in another format needs a reader that writes the same two files with the same columns. A catalog that marks no status at all seeds no withdrawn controls, and the app shows none of what follows.

A catalog drawn from another one, carrying a subset of its controls under the same numbers, can take that catalog's lineage by control number without publishing any withdrawal data of its own: the rows key on the number, and the foreign keys are set only where the number is seeded.

## At the current pin

Measured against NIST SP 800-53 Rev 5.2.0 and its previous release, 5.1.1+u4, on 2026-10-26:

- 182 withdrawn controls: 24 base controls and 158 enhancements, 136 of them under a live base.
- 200 successor rows: 166 incorporated into, 34 moved to. Eleven withdrawn controls have more than one successor. Two have none, CP-10(03) and SC-19.
- One successor is an item: AC-02(10) went into AC-02 item k, written `AC-02k`. One is a family: SA-12 went into the SR family.
- No successor is itself withdrawn, and the generator fails if one ever is, so every chain ends one step away.
- 142 live controls took in at least one withdrawn control. 93 of the 180 withdrawn controls with a successor have at least one successor carrying a Zero Trust mapping.
- 14 live base controls have only withdrawn enhancements: AC-14, AU-02, AU-08, IA-09, MP-02, PE-10, PE-18, PL-02, SA-05, SA-21, SA-22, SC-13, SC-21 and SC-26.
- Two live controls cite withdrawn enhancements in their discussion, five links in all: CM-07(05) cites CA-03(05), and PL-09 cites AU-07(02) and CA-03(01) to (03). Those links open the withdrawn tab.
- CISA's Zero Trust control mapping names none of the withdrawn controls.
- Since 5.1.1+u4: SA-15(13), SA-24 and SI-02(07) added; nothing dropped or newly withdrawn.

## What a reader sees

- **The layer cake, filters and combined view** show live controls only.
- **Enhancement tabs.** A control's withdrawn enhancements sit behind an "N withdrawn" toggle at the end of the tab strip, so the live tabs lead it. Expanded, they show struck through and dashed, with a legend. A withdrawn tab reached from a link shows while the toggle is collapsed, and hiding them from a withdrawn tab returns to the base. A control whose enhancements are all withdrawn shows Base and the toggle.
- **The withdrawn notice.** In place of the statement, one line in a grey box: the Withdrawn label and where the content went, "Incorporated into AC-02 and AU-06." Both kinds share the sentence when a control has both. A family reads as "the SR family", and its code opens the layer cake filtered to that family. The two empty states are "The catalog names no successor." and "Successors not recorded for this catalog." The baselines row, the catalog's references and the compliance note are not shown.
- **Item successors.** A successor named down to an item reads as `AC-02k`, and following it opens AC-02 with item k highlighted and scrolled into view. A live control's list says which item took each withdrawn control, "AC-02(10) (item k)".
- **What a live control took in.** Under the discussion, "Withdrawn Controls" lists them, split into incorporated here and moved here, each opening its record. A withdrawn base control, which the cake does not hold, opens from here as well.
- **The Zero Trust pane** of a withdrawn control names the successors that carry a mapping, with their pillars, each opening its record. It says so when none of them do.
- **Header chips.** "Withdrawn" beside a withdrawn control's number, and "New in 5.2.0" beside a control the release added; an added enhancement's tab carries "new".
- **Search** reads current controls. With "Search withdrawn controls" checked, the dropdown adds withdrawn controls, base and enhancement, matched by number and name, struck through and labelled withdrawn. They never narrow the diagram, and selecting one opens its record.
- **Copied text** states the withdrawal and its successors, or the withdrawn controls a live control took in.

## Where it lives

- Schema: `ControlStatus`, `LineageKind` and `ControlLineage` in `app/prisma/schema.prisma`, added by one additive migration.
- Generator: `app/prisma/generators/catalog/lineage.ts` resolves successors and the release delta; `sql-writer.ts` writes `15` and `16`; `generate-seed.ts` declares the lineage gate; `fetch-inputs.ts` verifies the previous release's catalog by blob SHA.
- Inputs: the previous release's catalog beside the current one in `app/prisma/sources/nist-800-53/`, recorded in `SOURCE.md`.
- API: `mapLineage` and `searchControls` in `app/src/server/api/routers/decoder.ts`.
- Interface: `app/src/app/_components/decoder-ring/lineage.tsx` (the notice, the chips, the list, the copied lines), `ControlModal.tsx` (the tab toggle and the Zero Trust pane), `statement.tsx` (the highlighted item), `SearchTypeahead.tsx` (the toggle) and `DecoderRing.tsx` (opening a control the cake does not hold).

## Related

- `docs/architecture/data-pipeline.md` — every seed file, its source and its generator.
- `docs/scripts/generate-nist-seed.md` — the catalog generator, its gates and its expected output.
- `app/prisma/sources/nist-800-53/SOURCE.md` — the two pinned catalogs.
