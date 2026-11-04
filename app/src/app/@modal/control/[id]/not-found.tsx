// The page beside this slot 404s for the same address and shows the not-found dialog
// ((cake)/control/[id]/not-found.tsx).
// Without this boundary the slot's 404 would fall through to the root and replace both.
export default function DirectLoadControlNotFound() {
  return null;
}
