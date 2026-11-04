/**
 * What the product calls the things it shows.
 *
 * Every catalog-specific string a component renders is a slot the product fills
 * rather than a literal in the markup. Catalog behaviour lives behind named
 * slots, never behind a conditional on the active catalog — the same shape the prose-decoration
 * predicate uses: the product supplies the value, the shared component knows
 * nothing about who is supplying it.
 *
 * This repository ships one product, Standard: the stock NIST SP 800-53 catalog
 * with the CISA Zero Trust Maturity Model. The slot mechanism stays, because it is
 * what keeps the components free of any catalog's vocabulary.
 */

export interface ProductConfig {
  /** The catalog's short name, used when the loaded catalog has no display label. */
  catalogFallbackLabel: string;
  /** Heading above the layer cake. */
  familiesHeading: string;
  /** The left pane's heading in the control modal. */
  controlPaneHeading: string;
  /** Heading for the catalog's own commentary on a control. */
  discussionHeading: string;
  /** Empty state for the left pane's reference links. */
  noControlLinksMessage: string;
  /** Legend and filter label for the chip state of a control the Zero Trust mapping does not cover. */
  baselineChipLabel: string;
  /** Loading state on first paint. */
  loadingMessage: string;
  /** The eyebrow above the product name in the page banner. */
  bannerEyebrow: string;
  /** Banner title. */
  bannerTitle: string;
  /** Browser tab title and search-engine snippet. */
  metadataTitle: string;
  /** Meta description, which is what a link preview shows. */
  metadataDescription: string;
  /** Footer attribution. */
  footerAttribution: string;
  /** What the Zero Trust pane and the control pane say for a control the Zero Trust mapping does
   *  not cover. It names the mapping's source and gives no reason the source does not. */
  ztUnmappedMessage: string;
  /** Accessible name of the "i" toggle on the References header. */
  referencesInfoLabel: string;
  /** Heading of the References explainer. */
  referencesInfoTitle: string;
  /** The explainer's paragraphs: where the references come from, how an entry
   *  is structured, and how a moved or unverifiable address is handled. The
   *  verification date is appended by the pane from the data, never from here. */
  referencesInfoBody: {
    source: string;
    structure: string;
    resolution: string;
    /** How an enhancement's list is built from its own references and its base's. */
    enhancement: string;
  };
  /** Chip on a reference an enhancement cites itself, above those it inherits from its base. */
  enhancementSpecificChip: string;
  /** Label of the control's frequency row. */
  frequencyLabel: string;
  /** Chip stating that the catalog leaves the frequency to the organization. */
  frequencyOrgDefinedChip: string;
  /** Chip when the control asks for no frequency at all. */
  frequencyNoneChip: string;
  /** Chip on an enhancement that asks for no frequency of its own, showing its base's. */
  frequencyInheritsChip: string;
  /** Label of the baselines row, and of the catalog's column in it and in the frequency row. */
  baselinesLabel: string;
  catalogColumnLabel: string;
  /** Every baseline the catalog defines, in display order; the row shows all of them. */
  catalogBaselines: string[];
  /** The filter bar's baseline facet: its label, and the option for controls in no baseline. */
  baselineFacetLabel: string;
  baselineFacetNone: string;
  /** The baseline facet button's tooltip: how a control matches a baseline. */
  baselineFacetHint: string;
  /** The priority row's label. */
  priorityLabel: string;
  /** The baselines row's explainer: what a solid and a light chip mean. */
  baselinesInfoLabel: string;
  baselinesInfoTitle: string;
  baselinesInfoBody: { applies: string; doesNotApply: string; privacy: string };
  /** Lead-in to the source of an inherited frequency, before the base control's id. */
  frequencyInheritedLead: string;
  /** Accessible name and heading of the frequency explainer. */
  frequencyInfoLabel: string;
  frequencyInfoTitle: string;
  /** The frequency explainer: what each of the three states means. */
  frequencyInfoBody: {
    organizationDefined: string;
    none: string;
    inherits: string;
  };
  /** Empty state for the Zero Trust pane's reference links. */
  noZtLinksMessage: string;
  /** Accessible name of the "i" toggle on the Zero Trust pane's References
   *  header. Must differ from referencesInfoLabel: both toggles sit on one page. */
  ztReferencesInfoLabel: string;
  /** Heading of the Zero Trust References explainer. */
  ztReferencesInfoTitle: string;
  /** The Zero Trust explainer's paragraphs, in the same three parts. */
  ztReferencesInfoBody: {
    source: string;
    structure: string;
    resolution: string;
    /** How an enhancement's list is built from its own references and its base's. */
    enhancement: string;
  };
}

/** Decoder Ring Standard — the NIST catalog with its own commentary. */
export const STANDARD: ProductConfig = {
  catalogFallbackLabel: "NIST SP 800-53",
  familiesHeading: "Control Families",
  controlPaneHeading: "Control",
  // The catalog's own guidance part, which is what NIST calls Discussion.
  discussionHeading: "Discussion",
  noControlLinksMessage: "No reference links available",
  baselineChipLabel: "Not in CISA's mapping",
  loadingMessage: "Loading controls...",
  bannerEyebrow: "ZERO TRUST",
  bannerTitle: "NIST SP 800-53 Zero Trust Crosswalk",
  metadataTitle: "Decoder Ring | NIST SP 800-53 to Zero Trust",
  metadataDescription:
    "Visual bridge between NIST SP 800-53 Rev 5 and the CISA Zero Trust Maturity Model",
  footerAttribution: "A U.S. government work, in the public domain",
  ztUnmappedMessage:
    "CISA's Zero Trust control mapping does not map this control.",
  referencesInfoLabel: "About these references",
  referencesInfoTitle: "About these references",
  referencesInfoBody: {
    source:
      "These are the references the NIST SP 800-53 catalog cites for this control, taken from the bibliography NIST publishes with the catalog.",
    structure:
      "Each entry names the publication, then what the link leads to: the kind of document and the site it opens on. A DOI link goes through doi.org to the publisher, shown as via doi.org. Entries are grouped by the site each link goes to. Each group's header counts its references and, on an enhancement's tab, how many are the enhancement's own and how many its base control's.",
    resolution:
      "Where a published address has moved, the link points at the current location. Where a site could not be checked automatically, the published address is kept.",
    enhancement:
      "NIST cites most sources at the base control. On an enhancement, the references it cites itself come first, marked enhancement-specific, followed by its base control's.",
  },
  enhancementSpecificChip: "Enhancement-specific",
  frequencyLabel: "Frequency",
  frequencyOrgDefinedChip: "Organization-defined",
  frequencyNoneChip: "No frequency parameter",
  frequencyInheritsChip: "Inherits from base",
  baselinesLabel: "Baselines",
  catalogColumnLabel: "NIST",
  catalogBaselines: ["Low", "Moderate", "High", "Privacy"],
  baselineFacetLabel: "Baseline",
  baselineFacetNone: "In no baseline",
  baselineFacetHint:
    "A control matches when it or any of its enhancements is in the baseline.",
  priorityLabel: "Priority",
  baselinesInfoLabel: "About these baselines",
  baselinesInfoTitle: "About these baselines",
  baselinesInfoBody: {
    applies:
      "Solid: NIST's baseline of that name includes this control or enhancement, so a system at that level selects it.",
    doesNotApply:
      "Light: that baseline does not include it. It can still be selected by tailoring; it is not required at that level.",
    privacy:
      "Low, Moderate and High follow a system's FIPS 199 impact level. Privacy is NIST's separate baseline for systems that process personally identifiable information.",
  },
  frequencyInheritedLead: "Set in the statement of its base control,",
  frequencyInfoLabel: "About these frequencies",
  frequencyInfoTitle: "About these frequencies",
  frequencyInfoBody: {
    organizationDefined:
      "Organization-defined: this control's own statement asks for the frequency, and NIST leaves the value for each organization to set. No NIST baseline assigns one.",
    none: "No frequency parameter: the control's statement asks for no frequency.",
    inherits:
      "Inherits from base: this enhancement's statement asks for no frequency, so the base control's frequency is shown for reference. That frequency is organization-defined too.",
  },
  noZtLinksMessage: "No Zero Trust references available",
  ztReferencesInfoLabel: "About these Zero Trust references",
  ztReferencesInfoTitle: "About these Zero Trust references",
  ztReferencesInfoBody: {
    source:
      "These are Zero Trust references chosen for this control from CISA, NIST and Office of Management and Budget publications: the CISA Zero Trust Maturity Model, OMB memoranda, and the guidance CISA and NIST publish, each cited at the page or section that addresses the control rather than by the catalog.",
    structure:
      "Each entry names the document, then what the link leads to: the kind of document and the site it opens on. Entries are grouped by the site each link goes to. Each group's header counts its references and, on an enhancement's tab, how many are the enhancement's own and how many its base control's.",
    resolution:
      "Where a published address has moved, the link points at the current location. Where a site could not be checked automatically, the published address is kept.",
    enhancement:
      "On an enhancement, the references chosen for it come first, marked enhancement-specific, followed by its base control's.",
  },
};

/** The product this deployment is. One line, one product. */
export const product: ProductConfig = STANDARD;
