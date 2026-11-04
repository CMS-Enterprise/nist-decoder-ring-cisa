import ControlModalLoading from "~/app/_components/decoder-ring/ControlModalLoading";

// Shown in the slot, over the cake, from the click until the intercepted page resolves.
// Only the in-app open needs it: a direct load already shows the cake's own spinner.
export default function InterceptedControlLoading() {
  return <ControlModalLoading />;
}
