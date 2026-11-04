import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emailPermitted,
  OIDC_PROVIDER_ID,
  oidcConfigured,
  oidcProviders,
  parseEmailDomains,
  readAuthSettings,
} from "../settings";

const ALL = {
  AUTH_OIDC_ISSUER: "https://idp.example.gov",
  AUTH_OIDC_ID: "decoder-ring",
  AUTH_OIDC_SECRET: "s3cret",
};

describe("readAuthSettings and oidcProviders", () => {
  it("configures nothing when no OIDC setting is present, so the app stays anonymous", () => {
    const s = readAuthSettings({});
    expect(oidcConfigured(s)).toBe(false);
    expect(oidcProviders(s)).toEqual([]);
    expect(s.signInLink).toBe(false);
  });

  it("configures one OIDC provider, with the issuer, id and secret given, when all three are set", () => {
    const [provider] = oidcProviders(readAuthSettings(ALL));
    expect(provider).toEqual({
      id: OIDC_PROVIDER_ID,
      name: "Single sign-on",
      type: "oidc",
      issuer: ALL.AUTH_OIDC_ISSUER,
      clientId: ALL.AUTH_OIDC_ID,
      clientSecret: ALL.AUTH_OIDC_SECRET,
      idToken: false,
    });
  });

  it("names the provider from AUTH_OIDC_NAME", () => {
    const [provider] = oidcProviders(
      readAuthSettings({ ...ALL, AUTH_OIDC_NAME: "Agency SSO" }),
    );
    expect(provider).toMatchObject({ name: "Agency SSO" });
  });

  it("treats an empty value as unset", () => {
    expect(
      oidcConfigured(readAuthSettings({ ...ALL, AUTH_OIDC_SECRET: "" })),
    ).toBe(false);
  });

  it("turns the header link on only for the exact value true", () => {
    expect(readAuthSettings({ AUTH_SIGNIN_LINK: "true" }).signInLink).toBe(
      true,
    );
    expect(readAuthSettings({ AUTH_SIGNIN_LINK: "false" }).signInLink).toBe(
      false,
    );
  });
});

describe("parseEmailDomains", () => {
  it("trims, lower-cases and drops a leading @", () => {
    expect(parseEmailDomains(" Agency.gov, @partner.gov ,")).toEqual([
      "agency.gov",
      "partner.gov",
    ]);
  });

  it("reads unset, empty and comma-only as no list, never as an empty one", () => {
    for (const value of [undefined, "", " , ,"]) {
      expect(parseEmailDomains(value)).toBeUndefined();
    }
  });

  it("is what readAuthSettings carries", () => {
    expect(
      readAuthSettings({ AUTH_ALLOWED_EMAIL_DOMAINS: "agency.gov" })
        .allowedEmailDomains,
    ).toEqual(["agency.gov"]);
    expect(readAuthSettings({}).allowedEmailDomains).toBeUndefined();
  });
});

describe("emailPermitted", () => {
  const list = ["agency.gov"];

  it("lets anyone in when there is no list, even with no address", () => {
    expect(emailPermitted("pat@elsewhere.org", undefined, undefined)).toBe(
      true,
    );
    expect(emailPermitted(undefined, undefined, undefined)).toBe(true);
  });

  it("admits a listed domain whatever its case", () => {
    expect(emailPermitted("pat@agency.gov", true, list)).toBe(true);
    expect(emailPermitted("Pat@AGENCY.GOV", true, list)).toBe(true);
  });

  it("refuses an unlisted domain, a subdomain and a lookalike", () => {
    expect(emailPermitted("pat@elsewhere.org", true, list)).toBe(false);
    expect(emailPermitted("pat@mail.agency.gov", true, list)).toBe(false);
    expect(emailPermitted("pat@notagency.gov", true, list)).toBe(false);
    expect(emailPermitted("pat@agency.gov.example.org", true, list)).toBe(
      false,
    );
  });

  it("refuses an address with more than one @, or nothing before it", () => {
    expect(emailPermitted("a@elsewhere.org@agency.gov", true, list)).toBe(
      false,
    );
    expect(emailPermitted("@agency.gov", true, list)).toBe(false);
  });

  it("reads email_verified as the issuer sends it, string or boolean", () => {
    for (const verified of [true, "true", "TRUE"]) {
      expect(emailPermitted("pat@agency.gov", verified, list)).toBe(true);
    }
    for (const verified of [false, "false", "False", 0, 1, "yes", ""]) {
      expect(emailPermitted("pat@agency.gov", verified, list)).toBe(false);
    }
  });

  it("refuses an address with no email_verified claim, unless the opt-out is set", () => {
    for (const verified of [undefined, null]) {
      expect(emailPermitted("pat@agency.gov", verified, list)).toBe(false);
      expect(emailPermitted("pat@agency.gov", verified, list, true)).toBe(true);
    }
  });

  it("refuses an explicitly unverified address even with the opt-out", () => {
    expect(emailPermitted("pat@agency.gov", false, list, true)).toBe(false);
    expect(emailPermitted("pat@agency.gov", "false", list, true)).toBe(false);
  });

  it("refuses an email claim that is not a string", () => {
    for (const email of [42, ["pat@agency.gov"], { value: "pat@agency.gov" }]) {
      expect(emailPermitted(email, true, list)).toBe(false);
    }
  });

  it("refuses an address the issuer marked unverified, and one with no address at all", () => {
    expect(emailPermitted("pat@agency.gov", false, list)).toBe(false);
    expect(emailPermitted(null, true, list)).toBe(false);
    expect(emailPermitted("", true, list)).toBe(false);
    expect(emailPermitted("no-at-sign", true, list)).toBe(false);
  });
});

describe("startup check in src/env.js", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function check() {
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    const { oidcConfigurationError } = await import("~/env");
    return oidcConfigurationError;
  }

  it("accepts none or all three", async () => {
    const f = await check();
    expect(f({})).toBeNull();
    expect(f(ALL)).toBeNull();
  });

  it.each([
    [
      { AUTH_OIDC_ISSUER: ALL.AUTH_OIDC_ISSUER },
      "AUTH_OIDC_ID, AUTH_OIDC_SECRET not",
    ],
    [{ AUTH_OIDC_ID: "x", AUTH_OIDC_SECRET: "y" }, "AUTH_OIDC_ISSUER not"],
  ])(
    "refuses a partial configuration and names what is missing",
    async (source, missing) => {
      const f = await check();
      expect(f(source)).toContain(missing);
    },
  );

  it("accepts a domain list alongside an issuer", async () => {
    const f = await check();
    expect(
      f({ ...ALL, AUTH_ALLOWED_EMAIL_DOMAINS: "agency.gov, @partner.gov" }),
    ).toBeNull();
  });

  it("refuses a domain list with no issuer", async () => {
    const f = await check();
    expect(f({ AUTH_ALLOWED_EMAIL_DOMAINS: "agency.gov" })).toContain(
      "AUTH_ALLOWED_EMAIL_DOMAINS is set but no OIDC issuer",
    );
  });

  it("refuses a list entry that is not a domain, naming it", async () => {
    const f = await check();
    const problem = f({
      ...ALL,
      AUTH_ALLOWED_EMAIL_DOMAINS: "agency.gov,agency,gov.,pat@agency.gov",
    });
    expect(problem).toContain("not domains: agency, gov., pat@agency.gov");
  });

  it("refuses a header link with no issuer", async () => {
    const f = await check();
    expect(f({ AUTH_SIGNIN_LINK: "true" })).toContain(
      "AUTH_SIGNIN_LINK is true",
    );
  });

  it("refuses the unverified-address opt-out with no domain list", async () => {
    const f = await check();
    expect(f({ ...ALL, AUTH_ALLOW_UNVERIFIED_EMAIL: "true" })).toContain(
      "AUTH_ALLOW_UNVERIFIED_EMAIL is true but no AUTH_ALLOWED_EMAIL_DOMAINS",
    );
    expect(
      f({
        ...ALL,
        AUTH_ALLOWED_EMAIL_DOMAINS: "agency.gov",
        AUTH_ALLOW_UNVERIFIED_EMAIL: "true",
      }),
    ).toBeNull();
  });

  it("in production, needs the public URL once an issuer is configured", async () => {
    const f = await check();
    const prod = { ...ALL, NODE_ENV: "production" };
    expect(f(prod)).toContain("Set AUTH_URL");
    expect(f({ ...prod, AUTH_URL: "https://decoder.example.gov" })).toBeNull();
    expect(f({ ...prod, AUTH_TRUST_HOST: "true" })).toBeNull();
    expect(f({ ...prod, AUTH_TRUST_HOST: "false" })).toContain("Set AUTH_URL");
  });

  it("needs nothing from an unconfigured app, in production or locally", async () => {
    const f = await check();
    expect(f({ NODE_ENV: "production" })).toBeNull();
    expect(f({ NODE_ENV: "development" })).toBeNull();
    expect(f({ ...ALL, NODE_ENV: "development" })).toBeNull();
  });
});
