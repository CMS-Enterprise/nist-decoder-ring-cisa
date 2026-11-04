import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";

import { useDismissibleDetails } from "../useDismissibleDetails";

function Popover() {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref);
  return (
    <details ref={ref} open data-testid="pop">
      <summary>i</summary>
      <p>inside</p>
    </details>
  );
}

describe("useDismissibleDetails", () => {
  it("closes on Escape and keeps that key press from reaching anything beneath", () => {
    const beneath = vi.fn();
    document.addEventListener("keydown", beneath);
    render(<Popover />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("pop")).not.toHaveAttribute("open");
    expect(beneath).not.toHaveBeenCalled();
    document.removeEventListener("keydown", beneath);
  });

  it("lets Escape through when nothing is open", () => {
    const beneath = vi.fn();
    document.addEventListener("keydown", beneath);
    render(<Popover />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(beneath).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", beneath);
  });

  it("closes on a click outside, and stays open on a click inside", () => {
    render(
      <>
        <Popover />
        <button type="button">elsewhere</button>
      </>,
    );
    fireEvent.mouseDown(screen.getByText("inside"));
    expect(screen.getByTestId("pop")).toHaveAttribute("open");
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.getByTestId("pop")).not.toHaveAttribute("open");
  });
});
