import ControlNotFound from "~/app/_components/decoder-ring/ControlNotFound";

// A direct load of an id that is not a control. The boundary sits under the (cake)
// layout, so the dialog shows over the cake, as it does for an in-app link.
export default function DirectLoadControlNotFound() {
  return <ControlNotFound />;
}
