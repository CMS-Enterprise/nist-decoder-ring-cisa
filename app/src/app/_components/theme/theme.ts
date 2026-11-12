/**
 * The reader's theme: light, dark, or the system's setting. The choice is kept in
 * localStorage under THEME_KEY, and the page shows it through one attribute,
 * <html data-theme="light" | "dark">, which globals.css keys every color token off.
 *
 * The attribute is set before first paint by the inline script the root layout puts in
 * <head> (themeScript), so a stored dark theme never flashes light first. The script is
 * applyTheme's own source, and the toggle calls the same function, so the two cannot
 * disagree about what a choice means.
 *
 * Tailored's dark mode and the accessibility scan can use the same attribute and key: a
 * scan sets dark by storing "dark" under THEME_KEY, or by choosing Dark in the toggle.
 */

export const THEME_KEY = "decoder-ring-theme";

export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The event a choice made in this tab sends, so every toggle on the page re-reads it. */
export const THEME_EVENT = "decoder-ring-theme-change";

/**
 * Sets data-theme from the stored choice, or from the system setting when none is stored,
 * and keeps following the system while none is. Its source is inlined as the <head>
 * script, so it must reference nothing outside itself.
 */
export function applyTheme(key: string): void {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const page = window as Window & {
    __decoderRingThemeListener?: boolean;
    __decoderRingThemeUnsaved?: string;
  };
  const stored = () => {
    // A choice storage refused (a private window, a policy) is held on the page instead.
    const unsaved = page.__decoderRingThemeUnsaved;
    if (unsaved !== undefined) return unsaved === "system" ? null : unsaved;
    try {
      const value = window.localStorage.getItem(key);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      // Storage blocked and nothing chosen yet: follow the system.
      return null;
    }
  };
  const apply = () => {
    root.dataset.theme = stored() ?? (media.matches ? "dark" : "light");
  };
  apply();
  // One set of listeners per page, however often this runs. Each re-reads storage, so a
  // stored choice still wins over the system, and a choice made in another tab (a
  // storage event for the key, or a cleared storage) shows here too.
  if (!page.__decoderRingThemeListener) {
    page.__decoderRingThemeListener = true;
    media.addEventListener("change", apply);
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key === key) apply();
    });
  }
}

/** The inline <head> script: applyTheme, called with the key. */
export const themeScript = `(${applyTheme.toString()})(${JSON.stringify(THEME_KEY)});`;

// Where a choice goes when storage refuses it. applyTheme reads the same property.
const page = () =>
  window as Window & { __decoderRingThemeUnsaved?: ThemeChoice };

/**
 * The reader's choice: the stored one, or one storage refused on this page. "system" when
 * there is neither.
 */
export function readThemeChoice(): ThemeChoice {
  const unsaved = page().__decoderRingThemeUnsaved;
  if (unsaved !== undefined) return unsaved;
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/**
 * Stores a choice and shows it. "system" removes the stored value, so the page follows the
 * system again. Where storage is blocked, the choice is held on the page instead, so the
 * page and the toggle still agree until it reloads.
 */
export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
    delete page().__decoderRingThemeUnsaved;
  } catch {
    page().__decoderRingThemeUnsaved = choice;
  }
  applyTheme(THEME_KEY);
  window.dispatchEvent(new Event(THEME_EVENT));
}
