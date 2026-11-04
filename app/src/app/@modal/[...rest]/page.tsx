// The modal slot on every other page, such as /export. Without it, a soft navigation from
// an open control to a page the slot has no match for would leave the modal drawn over it;
// default.tsx covers only a hard load.
export default function NoModalElsewhere() {
  return null;
}
