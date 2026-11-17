import { describe, it, expect } from "vitest";
import { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useDialogFocus } from "../useDialogFocus";

function Dialog({ fallback }: { fallback?: () => HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, fallback);
  return (
    <div ref={ref} role="dialog" aria-label="AC-02">
      <h2 data-dialog-start tabIndex={-1}>
        AC-02
      </h2>
      <button>Copy</button>
      <button>Close</button>
    </div>
  );
}

// The page and the dialog are siblings, as the cake and the @modal slot are in <body>.
function App({
  open,
  fallback,
}: {
  open: boolean;
  fallback?: () => HTMLElement | null;
}) {
  return (
    <>
      <div data-testid="page">
        <button>AC-02</button>
      </div>
      <div data-testid="already-inert" inert />
      {open ? <Dialog fallback={fallback} /> : null}
    </>
  );
}

describe("useDialogFocus", () => {
  it("takes focus, makes the page behind inert, and gives both back on close", () => {
    const { rerender } = render(<App open={false} />);
    const chip = screen.getByRole("button", { name: "AC-02" });
    chip.focus();

    rerender(<App open />);
    expect(document.activeElement).toBe(screen.getByRole("heading"));
    expect(screen.getByTestId("page").hasAttribute("inert")).toBe(true);

    rerender(<App open={false} />);
    expect(screen.getByTestId("page").hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("already-inert").hasAttribute("inert")).toBe(
      true,
    );
    expect(document.activeElement).toBe(chip);
  });

  // A click that opens the dialog may leave nothing focused (the cake's pan
  // library takes the press): the caller's fallback names the opener.
  it("wraps Tab and Shift+Tab at the dialog's ends", () => {
    render(<App open />);
    const copy = screen.getByRole("button", { name: "Copy" });
    const close = screen.getByRole("button", { name: "Close" });
    const dialog = screen.getByRole("dialog");

    // From the heading, Tab goes on to Copy as the browser takes it; Shift+Tab has
    // nothing before it, so it wraps to the last stop.
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(
      false,
    );
    expect(document.activeElement).toBe(close);

    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(copy);
    expect(fireEvent.keyDown(copy, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(close);
    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("gives focus to the fallback opener when nothing had focus", () => {
    const chip = () => screen.getByRole("button", { name: "AC-02" });
    const { rerender } = render(<App open={false} fallback={chip} />);
    (document.activeElement as HTMLElement | null)?.blur();

    rerender(<App open fallback={chip} />);
    expect(document.activeElement).toBe(screen.getByRole("heading"));

    rerender(<App open={false} fallback={chip} />);
    expect(document.activeElement).toBe(chip());
  });

  it("leaves live regions and the route announcer out of inert", () => {
    const { rerender } = render(
      <>
        <div aria-live="polite" data-testid="live" />
        <App open={false} />
      </>,
    );
    const announcer = document.createElement("next-route-announcer");
    document.body.append(announcer);
    rerender(
      <>
        <div aria-live="polite" data-testid="live" />
        <App open />
      </>,
    );
    expect(screen.getByTestId("live").hasAttribute("inert")).toBe(false);
    expect(announcer.hasAttribute("inert")).toBe(false);
    announcer.remove();
  });

  it("makes what is added behind an open dialog inert, and restores it on close", async () => {
    const { rerender } = render(<App open={false} />);
    rerender(<App open />);
    const late = document.createElement("div");
    document.body.append(late);
    await waitFor(() => expect(late.hasAttribute("inert")).toBe(true));
    rerender(<App open={false} />);
    expect(late.hasAttribute("inert")).toBe(false);
    late.remove();
  });

  it("falls back at close when the opener is gone", () => {
    const fallback = () => screen.getByRole("button", { name: "AC-02" });
    const { rerender } = render(<App open={false} fallback={fallback} />);
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    rerender(<App open fallback={fallback} />);
    opener.remove();
    rerender(<App open={false} fallback={fallback} />);
    expect(document.activeElement).toBe(fallback());
  });
});
