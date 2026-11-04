import { Suspense } from "react";

import ControlModalRoute from "~/app/_components/decoder-ring/ControlModalRoute";
import {
  controlMetadata,
  resolveControlRoute,
  type ControlRouteProps,
} from "~/app/(cake)/control/resolve";

export const generateMetadata = controlMetadata;

// An in-app open of /control/[id]: the cake stays mounted as `children` and this slot
// draws the modal over it. Resolved the same way as the direct-load page, so a link
// that reaches here with a loose or unknown id gets the same redirect or 404.
export default async function InterceptedControl({
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
