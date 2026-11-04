/**
 * The control modal's export menu: one control, in either format, with or without its
 * enhancements, and a way on to the full page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import QuickExport from "../QuickExport";

const params = (href: string) => new URLSearchParams(href.split("?")[1]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuickExport", () => {
  it("downloads the control with its enhancements by default, in the chosen format", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(Response.json({ error: "busy" }, { status: 429 })),
    );
    vi.stubGlobal("fetch", fetch);
    render(<QuickExport controlId="AC-02" hasEnhancements />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Download document/ }),
      );
    });
    const [href] = fetch.mock.calls[0] as unknown as [string];
    expect(href.startsWith("/api/export?")).toBe(true);
    expect(params(href).get("pick")).toBe("AC-02");
    expect(params(href).get("format")).toBe("docx");
    expect(params(href).get("enhancements")).toBeNull();
    expect(
      (await screen.findAllByText(/Try again in a few seconds/))[0],
    ).toBeInTheDocument();
  });

  it("leaves the enhancements out when unticked, in the download and the page link", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(Response.json({ error: "busy" }, { status: 429 })),
    );
    vi.stubGlobal("fetch", fetch);
    render(<QuickExport controlId="AC-02" hasEnhancements />);
    fireEvent.click(screen.getByLabelText("Include its enhancements"));
    expect(screen.getByRole("link", { name: "More options…" })).toHaveAttribute(
      "href",
      "/export?pick=AC-02&enhancements=without",
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Download spreadsheet/ }),
      );
    });
    const [href] = fetch.mock.calls[0] as unknown as [string];
    expect(params(href).get("enhancements")).toBe("without");
    expect(params(href).get("format")).toBeNull();
  });

  it("keeps the status in view after the menu closes, and the pressed button focusable", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((r) => (resolve = r))),
    );
    const { container } = render(
      <QuickExport controlId="AC-02" hasEnhancements={false} />,
    );
    const details = container.querySelector("details")!;
    details.open = true;
    const button = screen.getByRole("button", { name: /Download document/ });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    // Pending: marked, not disabled, so focus stays on it.
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();

    details.open = false;
    await act(async () => {
      resolve(Response.json({ error: "busy" }, { status: 429 }));
    });
    // Announced once, and shown on its own line; both outside the menu.
    const shown = await screen.findAllByText(/Try again in a few seconds/);
    expect(shown).toHaveLength(2);
    expect(shown.filter((el) => el.getAttribute("aria-live"))).toHaveLength(1);
    for (const el of shown) expect(details.contains(el)).toBe(false);
  });

  it("offers no enhancement choice for an enhancement or a base without any", () => {
    render(<QuickExport controlId="AC-02(01)" hasEnhancements={false} />);
    expect(screen.queryByLabelText("Include its enhancements")).toBeNull();
    expect(screen.getByRole("link", { name: "More options…" })).toHaveAttribute(
      "href",
      "/export?pick=AC-02(01)",
    );
  });
});
