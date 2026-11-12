/**
 * The theme switch: which theme a stored choice, or its absence, puts on <html>, and how
 * that follows the system. jsdom has no matchMedia, so each test installs a fake whose
 * `matches` and change listeners it controls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  readThemeChoice,
  setThemeChoice,
  THEME_EVENT,
  THEME_KEY,
  themeScript,
} from "../theme";

let systemDark = false;
let listeners: Array<() => void> = [];

function setSystem(dark: boolean) {
  systemDark = dark;
  for (const listener of listeners) listener();
}

beforeEach(() => {
  systemDark = false;
  listeners = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_: string, listener: () => void) =>
        listeners.push(listener),
    })),
  );
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete (window as { __decoderRingThemeListener?: boolean })
    .__decoderRingThemeListener;
  delete (window as { __decoderRingThemeUnsaved?: string })
    .__decoderRingThemeUnsaved;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const theme = () => document.documentElement.dataset.theme;

describe("applyTheme", () => {
  it("shows a stored choice whatever the system says", () => {
    setSystem(true);
    window.localStorage.setItem(THEME_KEY, "light");
    applyTheme(THEME_KEY);
    expect(theme()).toBe("light");

    setSystem(false);
    window.localStorage.setItem(THEME_KEY, "dark");
    applyTheme(THEME_KEY);
    expect(theme()).toBe("dark");
  });

  it.each([
    ["nothing", null],
    ["a value it doesn't know", "purple"],
  ])("follows the system with %s stored", (_, stored) => {
    if (stored) window.localStorage.setItem(THEME_KEY, stored);
    setSystem(true);
    applyTheme(THEME_KEY);
    expect(theme()).toBe("dark");
  });

  it("follows the system when storage can't be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setSystem(true);
    applyTheme(THEME_KEY);
    expect(theme()).toBe("dark");
  });

  it("keeps following the system while nothing is stored", () => {
    applyTheme(THEME_KEY);
    expect(theme()).toBe("light");
    setSystem(true);
    expect(theme()).toBe("dark");
    setSystem(false);
    expect(theme()).toBe("light");
  });

  it("lets a stored choice win over a later system change", () => {
    applyTheme(THEME_KEY);
    window.localStorage.setItem(THEME_KEY, "light");
    setSystem(true);
    expect(theme()).toBe("light");
  });

  it("shows a choice made in another tab", () => {
    applyTheme(THEME_KEY);
    expect(theme()).toBe("light");
    // The other tab writes storage; this one hears a storage event for the key.
    window.localStorage.setItem(THEME_KEY, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
    expect(theme()).toBe("dark");
    window.localStorage.removeItem(THEME_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
    expect(theme()).toBe("light");
  });

  it("ignores storage events for other keys", () => {
    applyTheme(THEME_KEY);
    window.localStorage.setItem(THEME_KEY, "dark");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "something-else" }),
    );
    expect(theme()).toBe("light");
  });

  it("listens for system changes once, however often it runs", () => {
    applyTheme(THEME_KEY);
    applyTheme(THEME_KEY);
    applyTheme(THEME_KEY);
    expect(listeners).toHaveLength(1);
  });
});

describe("themeScript", () => {
  // The <head> script is applyTheme's source run on its own, so it must not depend on
  // anything outside the function.
  it("sets the theme when run with nothing else loaded", () => {
    window.localStorage.setItem(THEME_KEY, "dark");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script under test is a string
    const run = new Function(themeScript) as () => void;
    run();
    expect(theme()).toBe("dark");
  });
});

describe("readThemeChoice", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    [null, "system"],
    ["purple", "system"],
  ] as const)("reads %s as %s", (stored, choice) => {
    if (stored) window.localStorage.setItem(THEME_KEY, stored);
    expect(readThemeChoice()).toBe(choice);
  });

  it("reads blocked storage as system", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readThemeChoice()).toBe("system");
  });
});

describe("setThemeChoice", () => {
  it("stores light or dark and shows it", () => {
    setSystem(true);
    setThemeChoice("light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    expect(theme()).toBe("light");
  });

  it("removes the stored choice for system, and follows the system again", () => {
    window.localStorage.setItem(THEME_KEY, "light");
    setSystem(true);
    setThemeChoice("system");
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(theme()).toBe("dark");
  });

  it("still shows a choice on this page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setThemeChoice("dark");
    expect(theme()).toBe("dark");
  });

  it("keeps a choice storage refused over the system, and reads it back", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setThemeChoice("dark");
    setSystem(false);
    expect(theme()).toBe("dark");
    expect(readThemeChoice()).toBe("dark");

    setThemeChoice("system");
    setSystem(true);
    expect(theme()).toBe("dark");
    setSystem(false);
    expect(theme()).toBe("light");
    expect(readThemeChoice()).toBe("system");
  });

  it("tells the page a choice was made", () => {
    const heard = vi.fn();
    window.addEventListener(THEME_EVENT, heard);
    setThemeChoice("dark");
    window.removeEventListener(THEME_EVENT, heard);
    expect(heard).toHaveBeenCalledOnce();
  });
});
