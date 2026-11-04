"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * Call `onEscape` when Escape is pressed, while the caller is mounted. Each dialog calls
 * this for itself, so whatever is on screen is what listens: one press makes one call,
 * and nothing navigates while no dialog is showing.
 */
export function useEscape(onEscape: () => void): void {
  const handle = useEffectEvent(onEscape);
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handle();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);
}
