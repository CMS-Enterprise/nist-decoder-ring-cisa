import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { config, proxy } from "../proxy";

/**
 * proxy.ts redirects percent-encoded spellings of a control id. Next decodes the path
 * segment before the page sees it, so resolveControlRoute can't tell "AC%2D02" from
 * "AC-02"; only the proxy still has the raw path.
 */
const run = (path: string) =>
  proxy(new NextRequest(new URL(path, "http://localhost")));
const locationOf = (path: string) => {
  const res = run(path);
  expect(res.status).toBe(307);
  return (
    new URL(res.headers.get("location")!).pathname +
    new URL(res.headers.get("location")!).search
  );
};
const passesThrough = (path: string) =>
  expect(run(path).headers.get("x-middleware-next")).toBe("1");

describe("proxy", () => {
  it("only runs on a control's address", () => {
    expect(config.matcher).toBe("/control/:id");
  });

  it("redirects a percent-encoded id to its stored form", () => {
    expect(locationOf("/control/AC%2D02")).toBe("/control/AC-02");
    expect(locationOf("/control/%41C-02")).toBe("/control/AC-02");
    expect(locationOf("/control/SC-37%2801%29")).toBe("/control/SC-37(01)");
  });

  it("rebuilds the query as the page's redirect does: commas kept, unknown keys dropped", () => {
    expect(
      locationOf("/control/AC%2D02?pillar=IDENTITY,DATA&utm_source=x&enh=1"),
    ).toBe("/control/AC-02?pillar=IDENTITY,DATA&enh=1");
  });

  it("keeps a valid ?item and drops one that isn't an item's path", () => {
    expect(locationOf("/control/AC%2D02?item=k")).toBe("/control/AC-02?item=k");
    expect(locationOf("/control/AC%2D02?item=%3Cb%3E")).toBe("/control/AC-02");
  });

  it("passes on an id with no escapes, and anything that doesn't decode to an id", () => {
    passesThrough("/control/AC-02");
    passesThrough("/control/%3Cb%3E");
    passesThrough("/control/%E0%A4%A");
  });
});
