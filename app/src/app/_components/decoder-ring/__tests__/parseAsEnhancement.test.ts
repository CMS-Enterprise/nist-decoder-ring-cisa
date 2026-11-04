import { describe, it, expect } from "vitest";

import { parseAsEnhancement } from "../filterParams";

describe("parseAsEnhancement", () => {
  it.each([
    ["1", "01"],
    ["01", "01"],
    ["12", "12"],
  ])("reads %j as %j", (value, expected) => {
    expect(parseAsEnhancement.parse(value)).toBe(expected);
  });

  it.each(["", "x", "001", "123", "1a", " 1", "-1"])(
    "reads %j as no tab",
    (value) => {
      expect(parseAsEnhancement.parse(value)).toBeNull();
    },
  );

  it("writes the value as it is", () => {
    expect(parseAsEnhancement.serialize("01")).toBe("01");
  });
});
