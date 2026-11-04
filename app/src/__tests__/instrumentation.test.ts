import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The boot hook is what makes a misconfigured container stop at start instead of passing its
 * health check and failing on the first request: the standalone server never loads
 * `next.config.js`, so `register()` is the first thing that imports `env.js`.
 */
describe("instrumentation register()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5439/db");
    for (const name of [
      "AUTH_OIDC_ISSUER",
      "AUTH_OIDC_ID",
      "AUTH_OIDC_SECRET",
      "AUTH_SIGNIN_LINK",
      "AUTH_ALLOWED_EMAIL_DOMAINS",
      "AUTH_ALLOW_UNVERIFIED_EMAIL",
    ]) {
      vi.stubEnv(name, "");
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** process.exit would end the test run, so it throws instead, carrying the code. */
  function trapExit() {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    return vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${String(code)}`);
    });
  }

  it("starts an app with no sign-in settings", async () => {
    const { register } = await import("~/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("exits on a partial sign-in configuration, naming what is missing", async () => {
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.gov");
    const exit = trapExit();
    const { register } = await import("~/instrumentation");
    await expect(register()).rejects.toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("AUTH_OIDC_ID, AUTH_OIDC_SECRET not"),
    );
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.gov");
    const exit = trapExit();
    const { register } = await import("~/instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });
});
