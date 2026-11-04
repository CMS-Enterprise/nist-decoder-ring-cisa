// The modal slot on "/". Without it, closing the modal (a navigation to "/") would leave
// the slot showing the control it last rendered, since a soft navigation keeps a slot's
// content when nothing in the slot matches the new URL.
export default function NoModalOnHome() {
  return null;
}
