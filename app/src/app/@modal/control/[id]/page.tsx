import { Suspense } from "react";

import ControlModalRoute from "~/app/_components/decoder-ring/ControlModalRoute";
import {
  resolveControlRoute,
  type ControlRouteProps,
} from "~/app/(cake)/control/resolve";

// The modal on a direct load of /control/[id], over the cake that the (cake) layout
// draws. Drawn in the slot, as an in-app open is, so a later open from inside it
// replaces this modal instead of stacking a second one over it. The page resolves the
// same address in the same request (lookupControl is cached), and owns the title.
export default async function DirectLoadControl({
  params,
  searchParams,
}: ControlRouteProps) {
  const { id, detail } = await resolveControlRoute(
    (await params).id,
    await searchParams,
  );
  return (
    <Suspense fallback={null}>
      <ControlModalRoute id={id} detail={detail} />
    </Suspense>
  );
}
