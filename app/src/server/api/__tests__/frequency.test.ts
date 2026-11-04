import { describe, it, expect } from "vitest";
import { frequencyFromParts } from "../frequency";

type P = { label: string | null; prose: string | null; children: P[] };
const part = (
  label: string | null,
  prose: string | null,
  children: P[] = [],
): P => ({
  label,
  prose,
  children,
});
const one = (prose: string, label: string | null = "a.") =>
  frequencyFromParts([part(label, prose)]).nist;

describe("frequencyFromParts", () => {
  it("reads each organization-defined frequency with its part and the words around it, as AC-01 states them", () => {
    const parts = [
      part("c.", "Review and update the current access control:", [
        part(
          "1.",
          "Policy [Assignment: organization-defined frequency] and following [Assignment: organization-defined events] ; and",
        ),
        part(
          "2.",
          "Procedures [Assignment: organization-defined frequency] and following [Assignment: organization-defined events].",
        ),
      ]),
    ];
    expect(frequencyFromParts(parts).nist).toEqual([
      {
        part: "(c)(1)",
        before: "Review and update the current access control: Policy",
        parameter: "organization-defined frequency",
        after: "and following organization-defined events",
      },
      {
        part: "(c)(2)",
        before: "Review and update the current access control: Procedures",
        parameter: "organization-defined frequency",
        after: "and following organization-defined events",
      },
    ]);
  });

  // Seed prose that once rendered an empty or bracket-littered lead-in.
  it("cuts a frequency that is one option of a selection at the selection (SI-04 g)", () => {
    expect(
      one(
        "Provide [Assignment: organization-defined system monitoring information] to [Assignment: organization-defined personnel or roles] [Selection (one or more): as needed; [Assignment: organization-defined frequency] ].",
        "g.",
      ),
    ).toEqual([
      {
        part: "(g)",
        before:
          "Provide organization-defined system monitoring information to organization-defined personnel or roles",
        parameter: "organization-defined frequency",
        after: "",
      },
    ]);
  });

  it("tells two frequencies in one clause apart by their words (CA-07 b)", () => {
    const [first, second] = one(
      "Establishing [Assignment: organization-defined frequencies] for monitoring and [Assignment: organization-defined frequencies] for assessment of control effectiveness;",
      "b.",
    );
    expect([first!.before, first!.after]).toEqual([
      "Establishing",
      "for monitoring and organization-defined frequencies for assessment of control effectiveness",
    ]);
    expect([second!.before, second!.after]).toEqual([
      "Establishing organization-defined frequencies for monitoring and",
      "for assessment of control effectiveness",
    ]);
  });

  it("keeps the words after a parameter that leads its clause (AC-06(07) a)", () => {
    const [f] = one(
      "Review [Assignment: organization-defined frequency] the privileges assigned to [Assignment: organization-defined roles and classes] to validate the need for such privileges; and",
    );
    expect(f!.before).toBe("Review");
    expect(f!.after).toBe(
      "the privileges assigned to organization-defined roles and classes to validate the need …",
    );
  });

  it("reads a selection after the frequency as a choice (CA-08(03))", () => {
    const [f] = one(
      "Employ a penetration testing process that includes [Assignment: organization-defined frequency] [Selection (one or more): announced; unannounced] attempts to bypass or circumvent controls associated with physical access points to the facility.",
      null,
    );
    expect(f!.after).toBe(
      "announced or unannounced attempts to bypass or circumvent controls associated with physical …",
    );
  });

  it("keeps punctuation that follows the frequency at the front of the text after it (AT-06, RA-03(01) b)", () => {
    const [at6] = one(
      "Provide feedback on organizational training results to the following personnel [Assignment: organization-defined frequency]: [Assignment: organization-defined personnel].",
      null,
    );
    expect(at6!.after).toBe(": organization-defined personnel");
    const [ra3] = one(
      "Update the supply chain risk assessment [Assignment: organization-defined frequency] , when there are significant changes to the relevant supply chain, or when changes occur.",
    );
    expect(ra3!.after.startsWith(", when there are significant")).toBe(true);
  });

  it("stops at the end of the selection a frequency sits in (SR-10, CM-03 g)", () => {
    const [sr10] = one(
      "Inspect the following systems or system components [Selection (one or more): at random; at [Assignment: organization-defined frequency] ; upon [Assignment: organization-defined indications of need for inspection] ] to detect tampering: [Assignment: organization-defined systems or system components].",
      null,
    );
    expect(sr10).toEqual({
      part: null,
      before: "Inspect the following systems or system components at",
      parameter: "organization-defined frequency",
      after: "",
    });
    const [cm3g] = one(
      "Coordinate and provide oversight for configuration change control activities through [Assignment: organization-defined configuration change control element] that convenes [Selection (one or more): [Assignment: organization-defined frequency] ; when [Assignment: organization-defined configuration change conditions] ].",
      "g.",
    );
    expect(cm3g!.before).toBe(
      "… oversight for configuration change control activities through organization-defined configuration change control element that convenes",
    );
  });

  it("keeps the option's own words when nothing precedes the selection (SI-14(02) a)", () => {
    const [f] = one(
      "[Selection: refresh [Assignment: organization-defined information] [Assignment: organization-defined frequency] ; generate [Assignment: organization-defined information] on demand] ; and",
      "(a)",
    );
    expect(f).toEqual({
      part: "(a)",
      before: "refresh organization-defined information",
      parameter: "organization-defined frequency",
      after: "",
    });
  });

  it("reads the plural and qualified wordings", () => {
    expect(
      frequencyFromParts([
        part(
          "b.",
          "Assess the controls [Assignment: organization-defined assessment frequency]",
        ),
        part(
          "c.",
          "Review logs at [Assignment: organization-defined frequencies]",
        ),
      ]).nist.map((f) => f.parameter),
    ).toEqual([
      "organization-defined assessment frequency",
      "organization-defined frequencies",
    ]);
  });

  it("finds nothing where the statement asks for no frequency, other parameters included", () => {
    expect(
      frequencyFromParts([
        part(
          "a.",
          "Notify [Assignment: organization-defined personnel or roles] of events.",
        ),
        part(null, null),
      ]).nist,
    ).toEqual([]);
  });

  it("reads every statement independently, so repeated calls agree", () => {
    const parts = [
      part("a.", "Review [Assignment: organization-defined frequency]"),
    ];
    expect(frequencyFromParts(parts)).toEqual(frequencyFromParts(parts));
  });
});
