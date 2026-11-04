import { describe, it, expect } from "vitest";

import { controlHref, parseAsItem } from "../filterParams";

describe("parseAsItem", () => {
  it.each(["k", "a.1", "a.1.b", "aa.10.b.2"])("reads %j as itself", (value) => {
    expect(parseAsItem.parse(value)).toBe(value);
  });

  it.each([
    "",
    "K",
    "k.",
    ".k",
    "a..1",
    "abc",
    "a.b.c.d.e",
    "<b>",
    "a b",
    "a-1",
  ])("reads %j as no item", (value) => {
    expect(parseAsItem.parse(value)).toBeNull();
  });

  it("writes the value as it is", () => {
    expect(parseAsItem.serialize("a.1")).toBe("a.1");
  });
});

describe("controlHref — the item", () => {
  it("puts the item after the filters and the tab", () => {
    expect(controlHref("AC-02", "01", "?pillar=DATA", "a.1")).toBe(
      "/control/AC-02?pillar=DATA&enh=01&item=a.1",
    );
    expect(controlHref("AC-02", null, "", "k")).toBe("/control/AC-02?item=k");
  });

  it("leaves it out when there is none", () => {
    expect(controlHref("AC-02", null, "?pillar=DATA")).toBe(
      "/control/AC-02?pillar=DATA",
    );
  });
});
