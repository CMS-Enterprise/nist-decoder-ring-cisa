import { describe, it, expect, afterEach } from "vitest";
import { chipFor } from "../chipFor";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("chipFor", () => {
  it("finds a chip by its control, even one that links to an enhancement", () => {
    document.body.innerHTML = `<a href="/control/AC-02(01)" data-control-chip="AC-02">AC-02</a>`;
    expect(chipFor("AC-02")?.textContent).toBe("AC-02");
  });

  it("skips a dimmed chip, which is inert and cannot take focus", () => {
    document.body.innerHTML = `<a href="/control/AC-02" data-control-chip="AC-02" inert>AC-02</a>`;
    expect(chipFor("AC-02")).toBeNull();
  });

  it("finds nothing for a control with no chip", () => {
    document.body.innerHTML = `<a href="/control/AC-02" data-control-chip="AC-02">AC-02</a>`;
    expect(chipFor("AC-03")).toBeNull();
  });
});
