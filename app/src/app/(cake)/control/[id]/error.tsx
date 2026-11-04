"use client";

import ControlLoadError from "~/app/_components/decoder-ring/ControlLoadError";

// A direct load whose lookup failed (a database fault, not an unknown id). Same dialog
// as the in-app case, so a shared link that hits a bad moment can be retried in place.
export default function ControlError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return <ControlLoadError retry={retry} />;
}
