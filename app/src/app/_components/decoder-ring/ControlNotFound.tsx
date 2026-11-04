import ControlUnavailable from "./ControlUnavailable";

/**
 * What `/control/[id]` shows for an id that is not a control, whether the link was
 * followed in the app or loaded directly: a small dialog over the cake rather than a
 * page that replaces it. It never repeats what was asked for: the path is whatever a
 * link put there, and repeating it would let a link put its own words on the page.
 */
export default function ControlNotFound() {
  return (
    <ControlUnavailable title="No control by that ID">
      The link may be mistyped or out of date. IDs look like AC-02 or AC-02(01).
    </ControlUnavailable>
  );
}
