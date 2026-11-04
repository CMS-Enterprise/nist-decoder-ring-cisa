"use client";

// The page beside this slot fails on the same lookup and shows the retry dialog
// ((cake)/control/[id]/error.tsx). Rendering nothing here keeps it to one dialog.
export default function DirectLoadControlError() {
  return null;
}
