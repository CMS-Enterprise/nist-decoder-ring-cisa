"use client";

import ControlUnavailable from "./ControlUnavailable";

/**
 * What `/control/[id]` shows when resolving the control failed for a reason other than
 * the control not existing: getControlById threw something other than NOT_FOUND, which
 * resolveControlRoute rethrows so it stays a 500. Without a boundary that error falls
 * through to Next's default error page and replaces the whole app; here it is the same
 * small dialog as a missing control, with Try again first, since the cause is often
 * brief. Says nothing about the error itself: in production Next sends only a digest.
 */
export default function ControlLoadError({ retry }: { retry: () => void }) {
  return (
    <ControlUnavailable title="This control didn't load" onRetry={retry}>
      Something went wrong on our side. Try again, or go back to all controls.
    </ControlUnavailable>
  );
}
