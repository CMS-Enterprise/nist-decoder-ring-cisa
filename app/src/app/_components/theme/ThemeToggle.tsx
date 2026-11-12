"use client";

import { useId, useSyncExternalStore } from "react";

import {
  readThemeChoice,
  setThemeChoice,
  THEME_EVENT,
  THEME_KEY,
  type ThemeChoice,
} from "./theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

// A choice made in this tab announces itself; one made in another tab arrives as a
// storage event for the key.
function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === THEME_KEY) onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Light, dark or the system setting, as three native radios: the group is named "Theme",
 * a screen reader hears which one is chosen, and the arrow keys move between them. The
 * radios are visually hidden behind their labels, so the focus ring and the chosen state
 * are drawn on the label; the chosen one is filled and carries a check, not color alone.
 *
 * The server can't read the stored choice, so it renders System; the stored one replaces
 * it once the page hydrates. The page's colors never wait for this: the <head> script has
 * already applied the theme.
 */
export default function ThemeToggle() {
  const id = useId();
  const choice = useSyncExternalStore(
    subscribe,
    readThemeChoice,
    () => "system" as const,
  );

  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      className="flex items-center gap-2"
    >
      <span id={`${id}-label`} className="text-ink-muted text-xs font-medium">
        Theme
      </span>
      <div className="border-border-strong bg-surface flex rounded-md border p-0.5">
        {OPTIONS.map(({ value, label }) => {
          const checked = choice === value;
          return (
            <label
              key={value}
              className={`has-[:focus-visible]:outline-focus flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                checked
                  ? "bg-ink text-on-accent"
                  : "text-ink hover:bg-surface-muted"
              }`}
            >
              <input
                type="radio"
                name={`${id}-theme`}
                value={value}
                checked={checked}
                onChange={() => setThemeChoice(value)}
                className="sr-only"
              />
              {checked && <span aria-hidden="true">✓</span>}
              {label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
