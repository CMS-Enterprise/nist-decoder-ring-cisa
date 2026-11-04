/**
 * The server side of /control/[id]: how an address resolves, redirects or 404s.
 *
 * Mocks:
 *  - next/navigation: redirect() and notFound() end a request by throwing; here they
 *    throw sentinels that carry where the redirect went.
 *  - ~/trpc/server: the RSC caller; getControlById resolves for a known control and
 *    throws as the router does otherwise.
 *  - server-only: throws outside a server build.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("server-only", () => ({}));

class RedirectSentinel extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
class NotFoundSentinel extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSentinel(to);
  },
  notFound: () => {
    throw new NotFoundSentinel();
  },
}));

let mockGetControlById: ReturnType<typeof vi.fn>;
vi.mock("~/trpc/server", () => ({
  api: {
    decoder: {
      get getControlById() {
        return mockGetControlById;
      },
    },
  },
}));

// Import AFTER mocks are registered.
import { controlMetadata, resolveControlRoute } from "../resolve";
import { product } from "~/config/product";

// Each control in the test catalog, with the enhancements its detail lists. SC-37(01)
// stands in for an enhancement whose base control isn't in the catalog.
const CATALOG: Record<string, string[]> = {
  "AC-02": ["AC-02(01)"],
  "SI-04": [],
  "SC-37(01)": [],
};

beforeEach(() => {
  mockGetControlById = vi.fn(async ({ controlId }: { controlId: string }) => {
    const enhancements = CATALOG[controlId];
    if (enhancements) {
      return {
        id: controlId,
        enhancements: enhancements.map((id) => ({ id })),
      };
    }
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Control ${controlId} not found`,
    });
  });
});

/** Where resolveControlRoute redirected to, failing the test if it did not. */
async function redirectOf(id: string, search = {}) {
  const error: unknown = await resolveControlRoute(id, search).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RedirectSentinel);
  return (error as RedirectSentinel).to;
}

describe("resolveControlRoute — the stored form", () => {
  it("resolves a canonical id to its base control, with the detail it fetched", async () => {
    await expect(resolveControlRoute("AC-02", {})).resolves.toEqual({
      id: "AC-02",
      enhancement: null,
      detail: { id: "AC-02", enhancements: [{ id: "AC-02(01)" }] },
    });
    // Once: the detail is handed to the modal, not fetched again.
    expect(mockGetControlById).toHaveBeenCalledTimes(1);
    expect(mockGetControlById).toHaveBeenCalledWith({ controlId: "AC-02" });
  });

  it("keeps a valid ?enh on a canonical id without redirecting", async () => {
    await expect(
      resolveControlRoute("AC-02", { enh: "01" }),
    ).resolves.toMatchObject({ id: "AC-02", enhancement: "01" });
    // The base's lookup decides where the enhancement is served and is the detail too.
    expect(mockGetControlById).toHaveBeenCalledTimes(1);
  });

  it("redirects a loose spelling to the stored form", async () => {
    expect(await redirectOf("ac-2")).toBe("/control/AC-02");
    expect(await redirectOf("AC2")).toBe("/control/AC-02");
  });

  it("redirects an enhancement id, in either spelling, to its base with ?enh", async () => {
    expect(await redirectOf("AC-02(01)")).toBe("/control/AC-02?enh=01");
    expect(await redirectOf("ac-2.1")).toBe("/control/AC-02?enh=01");
    // Percent-encoded, as a browser may send the parentheses.
    expect(await redirectOf("AC-02%2801%29")).toBe("/control/AC-02?enh=01");
  });

  it("carries the filters through a redirect, dropping invalid and unknown parameters", async () => {
    expect(
      await redirectOf("ac-2", {
        pillar: "IDENTITY",
        maturity: "NOT_A_MATURITY",
        utm_source: "elsewhere",
      }),
    ).toBe("/control/AC-02?pillar=IDENTITY");
  });

  it("writes multi-value filters the way the cake's links do, commas unencoded", async () => {
    expect(await redirectOf("ac-2", { pillar: "IDENTITY,DATA" })).toBe(
      "/control/AC-02?pillar=IDENTITY,DATA",
    );
    expect(
      await redirectOf("AC-02(01)", {
        pillar: "IDENTITY,DATA",
        status: "compliance",
      }),
    ).toBe("/control/AC-02?pillar=IDENTITY,DATA&status=compliance&enh=01");
  });

  it("percent-encodes what a Location header can't carry, so the redirect isn't a 500", async () => {
    for (const [q, encoded] of [
      ["日本", "%E6%97%A5%E6%9C%AC"],
      ["\u201cx\u201d", "%E2%80%9Cx%E2%80%9D"],
      ["a\x7fb", "a%7Fb"],
      ["café", "caf%C3%A9"],
    ] as const) {
      const to = await redirectOf("ac-2", { q });
      expect(to).toBe(`/control/AC-02?q=${encoded}`);
      // What Node checks before it sends a header: nothing above U+00FF, no controls.
      expect(to).toMatch(/^[\x21-\x7e]+$/);
    }
  });

  it("drops an ?enh that is not one or two digits", async () => {
    expect(await redirectOf("AC-02", { enh: "01&from=zt" })).toBe(
      "/control/AC-02",
    );
    expect(await redirectOf("AC-02", { enh: "123" })).toBe("/control/AC-02");
    expect(await redirectOf("ac-2", { enh: "<b>" })).toBe("/control/AC-02");
  });

  it("drops a repeated ?enh, even when every copy is valid", async () => {
    expect(await redirectOf("AC-02", { enh: ["01", "02"] })).toBe(
      "/control/AC-02",
    );
    expect(await redirectOf("AC-02", { enh: ["01", "<b>"] })).toBe(
      "/control/AC-02",
    );
  });

  it("zero-pads a one-digit ?enh to the stored form", async () => {
    expect(await redirectOf("AC-02", { enh: "1" })).toBe(
      "/control/AC-02?enh=01",
    );
  });
});

describe("resolveControlRoute — the highlighted item", () => {
  it("keeps a valid ?item on the stored form without redirecting", async () => {
    await expect(
      resolveControlRoute("AC-02", { item: "k", enh: "01" }),
    ).resolves.toMatchObject({ id: "AC-02", enhancement: "01" });
  });

  it("carries the item through a redirect, after the filters and the tab", async () => {
    // A successor in another control's enhancement arrives by its own id.
    expect(await redirectOf("AC-02(01)", { item: "a.1", pillar: "DATA" })).toBe(
      "/control/AC-02?pillar=DATA&enh=01&item=a.1",
    );
    expect(await redirectOf("ac-2", { item: "k" })).toBe(
      "/control/AC-02?item=k",
    );
  });

  it("drops an ?item that isn't a short letter-and-digit path", async () => {
    for (const item of ["K", "a..1", "<script>", "abc", "a.b.c.d.e", ""]) {
      expect(await redirectOf("AC-02", { item, pillar: "DATA" })).toBe(
        "/control/AC-02?pillar=DATA",
      );
    }
  });

  it("drops a repeated ?item, even when every copy is valid", async () => {
    expect(await redirectOf("AC-02", { item: ["k", "a"] })).toBe(
      "/control/AC-02",
    );
  });

  it("drops the item with a tab the control doesn't have, so the base highlights nothing", async () => {
    for (const [id, search] of [
      ["AC-02", { enh: "99", item: "k", pillar: "DATA" }],
      ["AC-02", { enh: "abc", item: "k", pillar: "DATA" }],
      ["AC-02(99)", { item: "k", pillar: "DATA" }],
    ] as const) {
      expect(await redirectOf(id, search)).toBe("/control/AC-02?pillar=DATA");
    }
  });

  it("keeps the item when the tab is only spelled loosely, or served under its own id", async () => {
    expect(await redirectOf("AC-02", { enh: "1", item: "k" })).toBe(
      "/control/AC-02?enh=01&item=k",
    );
    expect(await redirectOf("SC-37", { enh: "1", item: "a" })).toBe(
      "/control/SC-37(01)?item=a",
    );
  });
});

describe("resolveControlRoute — an enhancement the control doesn't have", () => {
  it("redirects an unknown ?enh to the base control, keeping the filters", async () => {
    expect(await redirectOf("AC-02", { enh: "99", pillar: "DATA" })).toBe(
      "/control/AC-02?pillar=DATA",
    );
    expect(await redirectOf("SI-04", { enh: "01" })).toBe("/control/SI-04");
  });

  it("redirects an unknown enhancement id to its base, not to a tab that isn't there", async () => {
    expect(await redirectOf("AC-02(99)")).toBe("/control/AC-02");
    expect(await redirectOf("ac-2.99")).toBe("/control/AC-02");
  });

  it("checks against the base's own lookup, without a second query", async () => {
    await redirectOf("AC-02", { enh: "99" });
    expect(mockGetControlById).toHaveBeenCalledTimes(1);
  });
});

describe("resolveControlRoute — an enhancement without its base control", () => {
  it("serves it under its full id, as the chip on the cake names it", async () => {
    await expect(resolveControlRoute("SC-37(01)", {})).resolves.toEqual({
      id: "SC-37(01)",
      enhancement: null,
      detail: { id: "SC-37(01)", enhancements: [] },
    });
  });

  it("redirects its other spellings, and its base with ?enh, to the full id", async () => {
    expect(await redirectOf("sc-37.1")).toBe("/control/SC-37(01)");
    expect(await redirectOf("SC-37", { enh: "1" })).toBe("/control/SC-37(01)");
    expect(await redirectOf("SC-37(01)", { enh: "02", pillar: "DATA" })).toBe(
      "/control/SC-37(01)?pillar=DATA",
    );
  });

  it("404s an enhancement when neither it nor its base is in the catalog", async () => {
    await expect(resolveControlRoute("ZZ-99(01)", {})).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
  });
});

describe("resolveControlRoute — what is not a control", () => {
  it("404s an id that normalizes but is not in the catalog", async () => {
    await expect(resolveControlRoute("ZZ-99", {})).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
  });

  it("404s junk without asking the API", async () => {
    for (const junk of [
      "Your-session-expired",
      "%3Cscript%3E",
      "..",
      "%E0%A4%A",
      "a".repeat(500),
    ]) {
      await expect(resolveControlRoute(junk, {})).rejects.toBeInstanceOf(
        NotFoundSentinel,
      );
    }
    expect(mockGetControlById).not.toHaveBeenCalled();
  });

  it("lets any failure other than NOT_FOUND through as an error, not a 404", async () => {
    mockGetControlById = vi.fn(async () => {
      throw new Error("No active catalog version found");
    });
    await expect(resolveControlRoute("AC-02", {})).rejects.toThrow(
      "No active catalog version found",
    );
  });
});

describe("controlMetadata", () => {
  const titleOf = async (id: string) =>
    (await controlMetadata({ params: Promise.resolve({ id }) })).title;

  it("titles the page with the stored base id", async () => {
    expect(await titleOf("ac-2")).toBe(`AC-02 · ${product.metadataTitle}`);
    expect(await titleOf("AC-02(01)")).toBe(`AC-02 · ${product.metadataTitle}`);
  });

  it("skips the lookup for an address that is about to redirect", async () => {
    await titleOf("ac-2");
    expect(mockGetControlById).not.toHaveBeenCalled();
    // An enhancement id needs its base's lookup to know where it is served, and no more.
    await titleOf("AC-02(01)");
    expect(mockGetControlById).toHaveBeenCalledTimes(1);
  });

  it("titles an enhancement without its base control by its full id", async () => {
    expect(await titleOf("SC-37(01)")).toBe(
      `SC-37(01) · ${product.metadataTitle}`,
    );
  });

  it("uses the fixed title for an id the catalog doesn't have", async () => {
    expect(await titleOf("ZZ-99")).toBe(
      `Control not found · ${product.metadataTitle}`,
    );
  });

  it("keeps the id as the title when the lookup fails outright", async () => {
    mockGetControlById = vi.fn(async () => {
      throw new Error("connection refused");
    });
    expect(await titleOf("AC-02")).toBe(`AC-02 · ${product.metadataTitle}`);
  });

  it("uses a fixed title for a path that is not a control id, never its text", async () => {
    const title = await titleOf("Your-session-expired");
    expect(title).toBe(`Control not found · ${product.metadataTitle}`);
    expect(title).not.toContain("session");
  });
});
