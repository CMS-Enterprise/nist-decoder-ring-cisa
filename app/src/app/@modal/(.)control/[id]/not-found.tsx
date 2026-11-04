import ControlNotFound from "~/app/_components/decoder-ring/ControlNotFound";

// An in-app link to an id that is not a control. Without this boundary the 404 falls
// through to Next's bare "This page could not be found", which replaces the whole app.
export default function InterceptedControlNotFound() {
  return <ControlNotFound />;
}
