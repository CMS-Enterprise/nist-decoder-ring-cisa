import { describe, expect, it } from "vitest";

import config from "../../next.config.js";
import pkg from "../../package.json";

/**
 * The footer's version comes from here. If the build stopped supplying it, the footer would
 * quietly show no version rather than fail, so the wiring is asserted directly.
 */
describe("next.config.js", () => {
  it("inlines package.json's version as NEXT_PUBLIC_APP_VERSION", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.env?.NEXT_PUBLIC_APP_VERSION).toBe(pkg.version);
  });
});
