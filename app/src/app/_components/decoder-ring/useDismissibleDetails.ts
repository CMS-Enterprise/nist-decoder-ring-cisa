"use client";

import { useEffect, type RefObject } from "react";

/**
 * Native <details> popovers close only when their summary is clicked. This closes every
 * open <details> inside `ref` (the element itself included) on Escape or on a pointer-down
 * outside it. Escape is taken in the capture phase and stopped only when something was
 * open, so the same key press does not also close a modal underneath.
 */
export function useDismissibleDetails(
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const openWithin = (): Element[] => {
      const root = ref.current;
      if (!root) return [];
      const own = root.matches("details[open]") ? [root] : [];
      return [...own, ...root.querySelectorAll("details[open]")];
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const open = openWithin();
      if (open.length === 0) return;
      e.stopPropagation();
      open.forEach((d) => d.removeAttribute("open"));
    };
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        openWithin().forEach((d) => d.removeAttribute("open"));
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [ref]);
}
