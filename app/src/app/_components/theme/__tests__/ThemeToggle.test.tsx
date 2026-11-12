/**
 * The theme toggle: three native radios named as one group, the stored choice checked,
 * and a choice stored and shown at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ThemeToggle from "../ThemeToggle";
import { THEME_KEY } from "../theme";

let systemDark = false;

beforeEach(() => {
  systemDark = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return systemDark;
      },
      addEventListener: vi.fn(),
    })),
  );
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete (window as { __decoderRingThemeUnsaved?: string })
    .__decoderRingThemeUnsaved;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const theme = () => document.documentElement.dataset.theme;

describe("ThemeToggle", () => {
  it("is one group named Theme, with System chosen when nothing is stored", () => {
    render(<ThemeToggle />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toBeInTheDocument();
    expect(
      screen.getAllByRole("radio").map((r) => r.getAttribute("value")),
    ).toEqual(["light", "dark", "system"]);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("checks the stored choice", () => {
    window.localStorage.setItem(THEME_KEY, "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("radio", { name: /Dark/ })).toBeChecked();
  });

  it("marks the chosen option with a check as well as its fill", () => {
    window.localStorage.setItem(THEME_KEY, "light");
    render(<ThemeToggle />);
    expect(
      screen.getByRole("radio", { name: /Light/ }).closest("label"),
    ).toHaveTextContent("✓Light");
    expect(
      screen.getByRole("radio", { name: "Dark" }).closest("label"),
    ).not.toHaveTextContent("✓");
  });

  it("stores and shows Dark when it is chosen", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(theme()).toBe("dark");
    expect(screen.getByRole("radio", { name: /Dark/ })).toBeChecked();
  });

  it("removes the stored choice for System and follows the system", () => {
    window.localStorage.setItem(THEME_KEY, "light");
    systemDark = true;
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(theme()).toBe("dark");
    expect(screen.getByRole("radio", { name: /System/ })).toBeChecked();
  });

  it("moves the choice with the arrow keys", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_KEY, "light");
    render(<ThemeToggle />);
    screen.getByRole("radio", { name: /Light/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Dark/ })).toBeChecked();
    expect(theme()).toBe("dark");
  });

  it("shows Dark as chosen when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(theme()).toBe("dark");
    expect(screen.getByRole("radio", { name: /Dark/ })).toBeChecked();
  });

  it("follows a choice made in another tab", () => {
    render(<ThemeToggle />);
    window.localStorage.setItem(THEME_KEY, "dark");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
    });
    expect(screen.getByRole("radio", { name: /Dark/ })).toBeChecked();
  });
});
