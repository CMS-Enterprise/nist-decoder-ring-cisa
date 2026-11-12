import { afterEach, describe, expect, it, vi } from "vitest";

describe("appVersion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is the version the build inlined", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "1.2.3");
    vi.resetModules();
    const { appVersion } = await import("../version");
    expect(appVersion).toBe("1.2.3");
  });

  it("is undefined when the build supplied none", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "");
    vi.resetModules();
    const { appVersion } = await import("../version");
    expect(appVersion).toBeUndefined();
  });
});
