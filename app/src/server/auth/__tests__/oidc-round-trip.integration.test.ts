/**
 * Sign-in, end to end, against a real OIDC issuer.
 *
 * An in-process issuer (oidc-provider) plays the agency's identity provider. The test drives
 * Auth.js's own route handlers, built from the app's configuration factory, through the
 * authorization-code flow a browser would take: start sign-in, log in at the issuer, return
 * to the callback, and read the session. It then hands that session to `auth.me`, the
 * protected procedure, and checks the adapter wrote the user to the database.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { Provider as OidcIssuer } from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import type { db as AppDb } from "~/server/db";
import { createTestDb } from "~/test/db/harness";

import { createAuthConfig } from "../create-config";
import { oidcProviders, readAuthSettings } from "../settings";

const APP = "http://localhost:3000";
const CLIENT = { id: "decoder-ring-test", secret: "test-secret" };
const PERSON = {
  sub: "pat",
  email: "pat@example.gov",
  name: "Pat Example",
  email_verified: "true",
};
/** Signs in at the same issuer from a domain the restricted app does not list. */
const OUTSIDER = {
  sub: "lee",
  email: "lee@elsewhere.example.org",
  name: "Lee Outside",
};
/** In a listed domain, but the issuer says the address is unverified, as a string. */
const UNVERIFIED = {
  sub: "sam",
  email: "sam@example.gov",
  name: "Sam Unverified",
  email_verified: "false",
};
/** In a listed domain, but the issuer sends no email_verified claim at all. */
const UNCLAIMED = {
  sub: "kim",
  email: "kim@example.gov",
  name: "Kim Unclaimed",
};
const PEOPLE: Record<string, Record<string, string>> = {
  pat: PERSON,
  lee: OUTSIDER,
  sam: UNVERIFIED,
  kim: UNCLAIMED,
};

/** One cookie jar per origin, as a browser keeps them. */
class Jar {
  private cookies = new Map<string, string>();
  take(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair!.indexOf("=");
      const name = pair!.slice(0, at);
      const value = pair!.slice(at + 1);
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const db = createTestDb();
let server: Server;
let issuerUrl: string;
let handlers: ReturnType<typeof NextAuth>["handlers"];
/** The same app with `AUTH_ALLOWED_EMAIL_DOMAINS` set to the test person's domain only. */
let restricted: ReturnType<typeof NextAuth>["handlers"];

beforeAll(async () => {
  await db.$connect();
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuerUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const issuer = new OidcIssuer(issuerUrl, {
    clients: [
      {
        client_id: CLIENT.id,
        client_secret: CLIENT.secret,
        redirect_uris: [`${APP}/api/auth/callback/oidc`],
      },
    ],
    async findAccount(_ctx, id) {
      return {
        accountId: id,
        async claims() {
          return { ...(PEOPLE[id] ?? PERSON), sub: id };
        },
      };
    },
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name"],
    },
    features: { devInteractions: { enabled: true } },
    cookies: { keys: ["round-trip-test"] },
  });
  const handle = issuer.callback();
  server.on("request", (req, res) => {
    void handle(req, res);
  });

  const settings = readAuthSettings({
    AUTH_OIDC_ISSUER: issuerUrl,
    AUTH_OIDC_ID: CLIENT.id,
    AUTH_OIDC_SECRET: CLIENT.secret,
    AUTH_ALLOWED_EMAIL_DOMAINS: "example.gov",
  });
  const build = (domains?: string[]) =>
    NextAuth({
      ...createAuthConfig(db, oidcProviders(settings), domains),
      secret: "round-trip-secret",
      trustHost: true,
    }).handlers;
  handlers = build();
  restricted = build(settings.allowedEmailDomains);
});

afterAll(async () => {
  await db.user.deleteMany({
    where: {
      email: {
        in: [PERSON.email, OUTSIDER.email, UNVERIFIED.email, UNCLAIMED.email],
      },
    },
  });
  await db.$disconnect();
  await new Promise((resolve) => server.close(resolve));
});

/** Send a request to the app's Auth.js handlers with the app's cookies. */
async function app(
  jar: Jar,
  url: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: URLSearchParams;
  } = {},
  via: ReturnType<typeof NextAuth>["handlers"] = handlers,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", jar.header());
  const req = new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
  const res = init.method === "POST" ? await via.POST(req) : await via.GET(req);
  jar.take(res);
  return res;
}

/** Walk the issuer's login and consent screens until it redirects back to the app. */
async function throughIssuer(
  start: string,
  login = PERSON.sub,
): Promise<string> {
  const jar = new Jar();
  let url = start;
  let body: URLSearchParams | undefined;
  for (let step = 0; step < 12; step++) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      body,
      headers: {
        cookie: jar.header(),
        ...(body
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      redirect: "manual",
    });
    jar.take(res);
    body = undefined;
    const next = res.headers.get("location");
    if (next) {
      url = new URL(next, url).toString();
      if (url.startsWith(APP)) return url;
      continue;
    }
    // A login or consent page: submit its form, logging in as the test person.
    const html = await res.text();
    const action = /<form[^>]*action="([^"]+)"/.exec(html)?.[1];
    if (!action)
      throw new Error(
        `issuer page with no form at ${url} (${res.status}): ${html.replace(/\s+/g, " ").slice(0, 600)}`,
      );
    body = new URLSearchParams();
    for (const [tag] of html.matchAll(/<input[^>]*>/g)) {
      const name = /\bname="([^"]+)"/.exec(tag)?.[1];
      if (name) body.set(name, /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "");
    }
    if (body.has("login")) body.set("login", login);
    if (body.has("password")) body.set("password", "any");
    url = new URL(action, url).toString();
  }
  throw new Error("issuer never redirected back to the app");
}

/** Start sign-in at an app, log in at the issuer as `login`, and return the app's answer. */
async function signInAs(
  via: ReturnType<typeof NextAuth>["handlers"],
  login: string,
): Promise<{ browser: Jar; landed: Response }> {
  const browser = new Jar();
  const { csrfToken } = (await (
    await app(browser, `${APP}/api/auth/csrf`, {}, via)
  ).json()) as { csrfToken: string };
  const start = await app(
    browser,
    `${APP}/api/auth/signin/oidc`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: APP }),
    },
    via,
  );
  const callback = await throughIssuer(start.headers.get("location")!, login);
  return { browser, landed: await app(browser, callback, {}, via) };
}

describe("OIDC sign-in round trip", () => {
  it("signs in through the issuer, and the protected procedure sees the user", async () => {
    const browser = new Jar();

    const { csrfToken } = (await (
      await app(browser, `${APP}/api/auth/csrf`)
    ).json()) as {
      csrfToken: string;
    };
    const start = await app(browser, `${APP}/api/auth/signin/oidc`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: APP }),
    });
    const authorize = start.headers.get("location");
    expect(authorize).toMatch(new RegExp(`^${issuerUrl}/auth\\?`));

    const callback = await throughIssuer(authorize!);
    expect(callback).toContain("/api/auth/callback/oidc?");

    const landed = await app(browser, callback);
    expect(landed.status).toBe(302);
    expect(browser.header()).toMatch(/session-token=/);

    const session = (await (
      await app(browser, `${APP}/api/auth/session`)
    ).json()) as {
      user: { id: string; email: string; name: string };
      expires: string;
    };
    expect(session.user).toMatchObject({
      email: PERSON.email,
      name: PERSON.name,
    });

    const caller = createCallerFactory(appRouter)({
      db: db as unknown as typeof AppDb,
      session,
      headers: new Headers(),
    });
    expect(await caller.auth.me()).toEqual({
      id: session.user.id,
      name: PERSON.name,
      email: PERSON.email,
    });

    const account = await db.account.findFirst({
      where: { userId: session.user.id },
    });
    expect(account).toMatchObject({
      provider: "oidc",
      providerAccountId: PERSON.sub,
    });
  });

  it("with a domain list, admits a listed domain", async () => {
    const { browser, landed } = await signInAs(restricted, PERSON.sub);
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe(APP);
    expect(browser.header()).toMatch(/session-token=/);
  });

  it("with a domain list, turns away an unlisted domain before storing anything", async () => {
    const { browser, landed } = await signInAs(restricted, OUTSIDER.sub);
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toContain("error=AccessDenied");
    expect(browser.header()).not.toMatch(/session-token=/);
    expect(await db.user.count({ where: { email: OUTSIDER.email } })).toBe(0);
  });

  it("with a domain list, turns away a listed domain the issuer says is unverified", async () => {
    const { browser, landed } = await signInAs(restricted, UNVERIFIED.sub);
    expect(landed.headers.get("location")).toContain("error=AccessDenied");
    expect(browser.header()).not.toMatch(/session-token=/);
    expect(await db.user.count({ where: { email: UNVERIFIED.email } })).toBe(0);
  });

  it("with a domain list, turns away a listed domain the issuer sends no claim for", async () => {
    const { browser, landed } = await signInAs(restricted, UNCLAIMED.sub);
    expect(landed.headers.get("location")).toContain("error=AccessDenied");
    expect(browser.header()).not.toMatch(/session-token=/);
    expect(await db.user.count({ where: { email: UNCLAIMED.email } })).toBe(0);
  });

  it("refuses the protected procedure without a session", async () => {
    const caller = createCallerFactory(appRouter)({
      db: db as unknown as typeof AppDb,
      session: null,
      headers: new Headers(),
    });
    await expect(caller.auth.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
