"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

// Kept out of inert: a live region must still announce, and Next's route
// announcer reports a navigation made from inside the dialog.
const keepLive = (el: Element) =>
  el.localName === "next-route-announcer" ||
  el.hasAttribute("aria-live") ||
  ["script", "style", "template", "link", "noscript"].includes(el.localName);

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]';

/** What Tab stops on inside the dialog, in document order. */
const tabStops = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !el.closest("[inert]") &&
      (el.checkVisibility?.() ?? true),
  );

/**
 * Makes the element a modal dialog for keyboard and screen reader users while it is
 * mounted: focus moves to its [data-dialog-start] element, everything outside it is inert (out of the Tab order
 * and the accessibility tree, as it is out of sight behind the scrim), including what
 * is added while it is open, Tab and Shift+Tab wrap at its ends, and on close focus
 * goes back to what opened it. Without this, Tab walked the cake behind the overlay.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  // What opened the dialog when nothing outside it had focus, or when what had focus
  // is gone or inert by the time it closes: a mouse click on a cake chip never focuses
  // it (the pan library takes the press), so the caller names the chip.
  fallbackOpener?: () => HTMLElement | null,
): void {
  const findOpener = useEffectEvent(() => fallbackOpener?.() ?? null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const usable = (el: HTMLElement | null) =>
      el?.isConnected && !el.closest("[inert]") ? el : null;
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement &&
      active !== document.body &&
      !dialog.contains(active)
        ? active
        : findOpener();

    // Every sibling of the dialog and of each of its ancestors up to <body> is the
    // page behind it. Only what this dialog made inert is restored, so a sibling that
    // was already inert for its own reasons stays that way. The attribute, not the
    // property: it is what React renders, and every DOM implements it.
    const made: Element[] = [];
    const wall = (el: Element, keep: Element) => {
      if (el === keep || el.hasAttribute("inert") || keepLive(el)) return;
      el.setAttribute("inert", "");
      made.push(el);
    };
    // Each ancestor level, by its parent, with the child on the dialog's path.
    const levels = new Map<Node, Element>();
    const added = new MutationObserver((records) => {
      for (const r of records) {
        const keep = levels.get(r.target);
        if (!keep) continue;
        for (const n of Array.from(r.addedNodes))
          if (n instanceof Element) wall(n, keep);
      }
    });
    for (
      let keep: Element = dialog;
      keep.parentElement && keep !== document.body;
      keep = keep.parentElement
    ) {
      const parent = keep.parentElement;
      for (const el of Array.from(parent.children)) wall(el, keep);
      levels.set(parent, keep);
      added.observe(parent, { childList: true });
    }
    // Past the last stop, or before the first, the browser would leave the page.
    const wrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const stops = tabStops(dialog);
      const from = document.activeElement;
      const ahead = (el: HTMLElement) =>
        !!from &&
        !!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      const next = e.shiftKey
        ? stops.some((el) => el !== from && !ahead(el))
        : stops.some((el) => el !== from && ahead(el));
      if (next) return;
      e.preventDefault();
      (e.shiftKey ? stops.at(-1) : stops[0])?.focus();
    };
    dialog.addEventListener("keydown", wrap);
    // The dialog element itself never takes focus (WAI-ARIA APG); its marked start does.
    (dialog.querySelector<HTMLElement>("[data-dialog-start]") ?? dialog).focus({
      preventScroll: true,
    });
    return () => {
      added.disconnect();
      dialog.removeEventListener("keydown", wrap);
      for (const el of made) el.removeAttribute("inert");
      (usable(opener) ?? usable(findOpener()))?.focus({ preventScroll: true });
    };
  }, [ref]);
}
