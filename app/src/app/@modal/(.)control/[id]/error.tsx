"use client";

import ControlLoadError from "~/app/_components/decoder-ring/ControlLoadError";

// An in-app open whose lookup failed (a database fault, not an unknown id). The
// boundary sits inside the slot, so the cake in `children` stays on screen behind the
// dialog instead of Next's error page replacing the app.
export default function InterceptedControlError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return <ControlLoadError retry={retry} />;
}
