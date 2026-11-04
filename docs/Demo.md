# Demo

A scripted walkthrough of every feature, built on five controls. Each one stands for one Zero Trust state of the data, and between them they carry everything else the app shows: references, frequency, baselines, assessment procedures, designations, withdrawn controls and their successors, and what each release added. The sections build on each other, so work through them in order.

Every claim below is pinned by `app/src/server/api/routers/__tests__/demo-controls.integration.test.ts` against the seeded catalog. When a reseed changes what a step would show, that test fails, and this page is updated with it. Counts are from the NIST SP 800-53 Rev 5.2.0 seed, measured 2026-10-26.

Run the app first: `make setup`, then `make dev`, and open http://localhost:3000. Open a control from the layer cake to get its modal: the catalog pane on the left (statement, discussion, assessment procedures, References), the Zero Trust pane on the right (mapping, designations, guidance, Zero Trust References), and the enhancement tabs above them.

## The five controls

| Control                                            | Zero Trust state, as the cake shows it                                           | Also shows                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AC-02 Account Management                           | ZT Aligned + Enhancements: the base and 6 of its 12 live enhancements are mapped | Frequency in a lettered item and inherited, the full modal, a successor that is one item, a withdrawn control the cake does not hold |
| SI-02 Flaw Remediation                             | ZT Aligned + Enhancements                                                        | References in both panes, enhancement-specific references, an enhancement's own frequency, new in 5.2.0                              |
| CA-03 Information Exchange                         | ZT Aligned: the base alone is mapped                                             | Informative and If applicable, a missing test method, withdrawn tabs that end on another control                                     |
| SR-04 Provenance                                   | ZT Enhancements: only SR-04(04) is mapped                                        | The teal banner, no baseline, the end of a family chain                                                                              |
| IA-13 Identity Providers and Authorization Servers | Not in CISA's mapping                                                            | The unmapped wording, references only an enhancement cites                                                                           |

Three more are reached from these rather than opened from the cake: AC-13 from AC-02, and SA-12 and SC-19 through the withdrawn search.

## 1. The layer cake and its filters

**Find the five on the cake.** AC-02 and SI-02 are violet (**ZT Aligned + Enhancements**), CA-03 is blue (**ZT Aligned**), SR-04 is teal (**ZT Enhancements**) and IA-13 is grey (**Not in CISA's mapping**). These are the four states the legend names. A card's state comes from whether its base control, its live enhancements, both or neither carry a mapping.

**Filter them.** Each facet narrows the cake and leaves a chip naming itself, such as "ZT Designation: Informative".

- **ZT Designation → Informative** keeps CA-03, whose tuples are all Informative, and drops AC-02 and SI-02, which are Key and Supporting.
- **Baseline → In no baseline** keeps SR-04 and IA-13: neither is in any of NIST's four baselines.
- **Status → Not in CISA's mapping** keeps IA-13.
- **Family → SR** keeps the Supply Chain Risk Management family, SR-04 among it. Section 7 ends on this view.

**Collapse to matches** removes the controls a filter dims instead of dimming them. **Clear all** resets both.

## 2. AC-02: the full modal

**Open AC-02.** The tab strip reads **Base**, then twelve enhancement tabs (the six mapped ones teal), then **1 withdrawn**.

- **Baselines.** Low, Moderate and High solid, Privacy light. The row always shows all four; the light ones are the baselines the catalog does not place this control in.
- **Frequency.** **Organization-defined**, from item (j): "… accounts for compliance with account management requirements" at an organization-defined frequency. **Select AC-02(01):** its own statement asks for none, so the row reads **Inherits from base**, with AC-02's for reference.
- **Assessment Procedures.** 26 determination statements, then what to examine, whom to interview and what to test.
- **Zero Trust pane.** Six tuples across Identity, Applications and Workloads and Data, so a coverage summary heads the pane. Each tuple carries CISA's designation, **Key** or **Supporting**, and its guidance reads in the maturity model's terms ("Agency authorizes: …").
- **References.** Each pane's **i** explains where its list comes from, how it is grouped by site and what each container's header counts.
- **Copy Guidance Text** copies the control, its guidance, discussion, assessment and references as plain text.

## 3. AC-02: where withdrawn controls lead

**Select 1 withdrawn.** AC-02(10) appears, struck through and dashed, with a legend under the strip. Select it. In place of a statement, one line in a grey box carries the **Withdrawn** label and **Incorporated into AC-02k.** The catalog names one item of AC-02, k, rather than the whole control. A withdrawn control carries no Zero Trust mapping, so its Zero Trust pane lists AC-02k with AC-02's pillars instead. Copy Guidance Text here includes the line "Status: Withdrawn, incorporated into AC-02k".

**Select AC-02k.** The modal returns to AC-02's base tab with item k highlighted and scrolled into view. The chain ends where it started.

**On the base tab, under the discussion,** "Withdrawn Controls" reads **Incorporated here: AC-02(10) (item k), AC-13, SC-14 and SI-09**. **Select AC-13.** It is a withdrawn base control, so it is not on the cake, but it opens here: a **Withdrawn** chip by its number, **Incorporated into AC-02 and AU-06**, and a Zero Trust pane listing both with their pillars. Either one ends the chain at a live, mapped control.

## 4. SI-02: references, an enhancement's own frequency, and what is new

**Open SI-02.** The catalog References pane lists 8 in two containers, **doi.org (7)** and **whitehouse.gov (1)**; the Zero Trust References pane lists 2, **cisa.gov (1)** and **whitehouse.gov (1)**. The Frequency row reads **No frequency parameter**: SI-02's own statement asks for none.

**Select SI-02(02).** The Frequency row now shows the enhancement's own organization-defined frequency. The Zero Trust References pane lists 4, three of them with the **Enhancement-specific** chip: **cisa.gov (3): 3 enhancement references** and **whitehouse.gov (1): 1 base reference**. One of SI-02(02)'s three is also SI-02's, and it appears once, as the enhancement's own. The catalog pane lists SI-02's 8 unchipped: SI-02(02) cites nothing of its own there, which is the catalog's usual shape.

**Select SI-02(07).** Its tab carries **new**, and the header shows **New in 5.2.0**: the release added it. **Select 1 withdrawn, then SI-02(01):** **Incorporated into PL-09.**

## 5. CA-03: the base alone is mapped

**Open CA-03.** Its two live enhancements are tan, not teal: neither is mapped. The Zero Trust pane has four tuples, Networks twice, Applications and Workloads, and Data, all **Informative**. The Application Access tuple also carries **If applicable**: it holds only where the capability is in the system's scope.

**Assessment Procedures** lists what to examine and whom to interview, and says **No test method is available for this control**: the publication gives none for it, one of 108 such controls.

**Select 5 withdrawn.** Each of CA-03(01) to (05) went into an SC-07 enhancement. **Select CA-03(05), then SC-07(05):** SC-07 opens on its (05) tab. A chain can end on another control's enhancement, landing on that tab rather than the base. A cross-reference in prose lands the same way: CM-07(05)'s discussion links CA-3(5), which opens CA-03 on that withdrawn tab even while its withdrawn tabs are collapsed.

## 6. SR-04 and IA-13: enhancements only, and not mapped at all

**Open SR-04.** The base tab shows a teal banner, **ZT alignment available in enhancements — select a teal tab below**, and its own Zero Trust pane reads **CISA's Zero Trust control mapping does not map this control.** The Baselines row is all light: SR-04 is in no baseline. Its 10 catalog references span five sites. **Select SR-04(04):** one tuple, the Devices pillar's Asset and Supply Chain function at Advanced, designated **Supporting**, with its one Zero Trust reference chipped as its own.

**Open IA-13.** Both panes say **CISA's Zero Trust control mapping does not map this control.**, with no reason given, because CISA's mapping gives none: Standard takes in what NIST and CISA publish and authors no mapping of its own. The catalog References pane reads **No reference links available**. **Select IA-13(03):** 3 references, every one chipped, **doi.org (3): 3 enhancement references**. An enhancement can cite what its base does not.

## 7. The withdrawn search, and where its chains end

**Search "SA-12".** Nothing: search reads the catalog's current controls. **Check Search withdrawn controls.** SA-12 and its 15 enhancements appear, struck through and labelled withdrawn. The cake does not change, because it shows current controls only.

**Open SA-12.** **Incorporated into the SR family.** **Select SR:** the modal closes and the cake filters to the SR family, the same view as Family → SR in section 1, with SR-04 on it.

**Back on SA-12, select 15 withdrawn.** SA-12(01) was **moved to SR-05**, and SA-12(14) was **incorporated into SR-04(01) and SR-04(02)**; following the first opens SR-04 on its (01) tab. Every chain from a withdrawn control ends one step away, at a live control, a family or nothing, and the generator fails a run in which a successor is itself withdrawn.

**Search "SC-19"** with the box still checked, and open it: **The catalog names no successor.** That is the third kind of end, stated rather than left blank.

## How Decoder Ring Tailored differs

Decoder Ring Tailored is a separate edition of this app, built over an agency's own tailored catalog. It runs the same modal with the same shared References module.

- **Catalog References pane.** Tailored's catalog cites its references as text rather than as links, so its catalog pane is empty for now, with an explainer saying so. Its enhancement chips show in the Zero Trust pane only.
- **Frequency.** Tailored's catalog publishes a review and an assessment frequency for every control, and its Zero Trust mapping carries its own; the row shows both side by side and marks where they disagree. Here the row reads NIST's own frequency parameters, and CISA's mapping publishes none to compare.
- **Baselines.** Tailored's catalog has its own baseline set, including two that do not exist here, and no Privacy baseline.
- **Withdrawn controls.** Tailored's catalog marks none withdrawn, so its modal shows no withdrawn tabs or successors.
