import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { CATALOG_MARKERS } from "~/config/catalog-vocabulary";
import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";

const callerWith = (session: unknown) =>
  createCallerFactory(appRouter)({
    db: {} as never,
    session: session as never,
    headers: new Headers(),
  });

describe("auth.me", () => {
  it("returns the signed-in user", async () => {
    const me = await callerWith({
      user: { id: "u1", name: "Pat Example", email: "pat@example.gov" },
      expires: "2099-01-01T00:00:00.000Z",
    }).auth.me();
    expect(me).toEqual({
      id: "u1",
      name: "Pat Example",
      email: "pat@example.gov",
    });
  });

  it("serves a person their own details when those carry catalog vocabulary", async () => {
    // Built from the term list, as the boundary tests are: an address at a host on the
    // list, and a name carrying a word on it. The boundary would refuse either elsewhere.
    const host = CATALOG_MARKERS.find((m) => m.includes("."))!;
    const word = CATALOG_MARKERS.find((m) => /^[A-Za-z]+$/.test(m))!;
    const user = { id: "u2", name: `Pat ${word}`, email: `pat@${host}` };
    const me = await callerWith({
      user,
      expires: "2099-01-01T00:00:00.000Z",
    }).auth.me();
    expect(me).toEqual(user);
  });

  it("refuses without a session", async () => {
    await expect(callerWith(null).auth.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
