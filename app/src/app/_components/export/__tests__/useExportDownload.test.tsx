/**
 * How the export download reports each answer from /api/export, and names the file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useExportDownload } from "../useExportDownload";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const answer = async (response: Response | Promise<Response>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => response),
  );
  const { result } = renderHook(() => useExportDownload());
  await act(async () => {
    await result.current.download("/api/export?pick=AC-02", "export.xlsx");
  });
  return result.current.status;
};

describe("useExportDownload", () => {
  it("shows the route's own reason for a refused selection", async () => {
    expect(
      await answer(
        Response.json({ error: "No control matches ZZ-99." }, { status: 400 }),
      ),
    ).toEqual({ kind: "failed", message: "No control matches ZZ-99." });
  });

  it("tells the build cap's 429 from the load balancer's rate limit", async () => {
    expect(
      await answer(
        Response.json(
          { error: "Too many exports are being built." },
          { status: 429, headers: { "Retry-After": "5" } },
        ),
      ),
    ).toEqual({ kind: "busy" });
    expect(
      await answer(
        new Response("Too many requests. Try again in a few minutes.", {
          status: 429,
          headers: { "Content-Type": "text/plain", "Retry-After": "300" },
        }),
      ),
    ).toEqual({ kind: "limited" });
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    expect(
      await answer(new Response("<html>Bad gateway</html>", { status: 502 })),
    ).toEqual({ kind: "failed", message: "The export failed (502)." });
  });

  it("says the export could not be reached when the request fails", async () => {
    expect(await answer(Promise.reject(new TypeError("fetch failed")))).toEqual(
      { kind: "failed", message: "The export could not be reached." },
    );
  });

  it("saves under the fallback name without a Content-Disposition, and frees the blob after", async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    expect(await answer(new Response("bytes"))).toEqual({ kind: "idle" });
    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).download).toBe(
      "export.xlsx",
    );
    // Revoked a tick after the click, not during it.
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
