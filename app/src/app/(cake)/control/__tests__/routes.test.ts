import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Next decides from folder names alone whether an open is intercepted into the modal
 * slot or loads the full page, and a misnamed folder still builds: every open would
 * fall back to a full page load and the component tests would stay green. This pins
 * the layout the control route depends on.
 */
const app = path.resolve(import.meta.dirname, "../../..");
const file = (p: string) => path.join(app, p);

describe("the control route's files", () => {
  it("intercepts an in-app open into the @modal slot", () => {
    expect(existsSync(file("@modal/(.)control/[id]/page.tsx"))).toBe(true);
  });

  it("draws a direct load's modal in the slot too, not in the page", () => {
    expect(existsSync(file("@modal/control/[id]/page.tsx"))).toBe(true);
    const page = readFileSync(file("(cake)/control/[id]/page.tsx"), "utf8");
    expect(page).not.toContain("ControlModalRoute");
  });

  // A page swap unmounts what the page drew. Drawn once in the layout above "/" and
  // "/control/[id]", the cake survives closing a control opened from a shared link
  // (a navigation from one page to the other) with its zoom and pan.
  it("draws the cake once, in the layout both pages share", () => {
    const layout = readFileSync(file("(cake)/layout.tsx"), "utf8");
    expect(layout).toContain("<DecoderRing");
    // After the Suspense, not in it, so a page's 404 or redirect keeps its status.
    expect(layout).toMatch(/<\/Suspense>\s*\{children\}/);
    for (const page of ["(cake)/page.tsx", "(cake)/control/[id]/page.tsx"]) {
      expect(readFileSync(file(page), "utf8")).not.toContain("<DecoderRing");
    }
    expect(existsSync(file("page.tsx"))).toBe(false);
    expect(existsSync(file("control"))).toBe(false);
  });

  it("clears the slot on / and on routes without a control", () => {
    expect(existsSync(file("@modal/page.tsx"))).toBe(true);
    expect(existsSync(file("@modal/default.tsx"))).toBe(true);
    // A soft navigation to any other page, such as /export from a control's Export menu.
    expect(existsSync(file("@modal/[...rest]/page.tsx"))).toBe(true);
    expect(readFileSync(file("layout.tsx"), "utf8")).toMatch(/\{modal\}/);
  });
});
