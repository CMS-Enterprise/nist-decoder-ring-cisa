import { describe, expect, it } from "vitest";
import { formatPartLabel } from "../part-label";

describe("formatPartLabel", () => {
  it("adds a separator to a bare marker, as another catalog publishes them", () => {
    expect(formatPartLabel("a")).toBe("a.");
    expect(formatPartLabel("1")).toBe("1.");
  });

  it("does not double a period the catalog already published", () => {
    // NIST publishes "a." at the first level and "1." at the second; appending
    // another rendered every item as "a.." on the page.
    expect(formatPartLabel("a.")).toBe("a.");
    expect(formatPartLabel("12.")).toBe("12.");
  });

  it("leaves bracketed markers intact, because they carry the nesting level", () => {
    // NIST's third level is "(a)". Reducing it to "a" — as another catalog's statement
    // parser does — makes level three indistinguishable from level one.
    expect(formatPartLabel("(a)")).toBe("(a)");
    expect(formatPartLabel("[1]")).toBe("[1]");
  });
});
