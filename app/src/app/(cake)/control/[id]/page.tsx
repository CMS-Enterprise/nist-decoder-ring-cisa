import {
  controlMetadata,
  resolveControlRoute,
  type ControlRouteProps,
} from "../resolve";

export const generateMetadata = controlMetadata;

// A control's address loaded directly: a shared link, a bookmark or a reload. The
// (cake) layout draws the cake, and the @modal slot draws the control's modal over it
// (@modal/control/[id]), so a deep link looks the same as opening the control from the
// cake. This page draws nothing; it is here to resolve the address. The modal stays in
// the slot because a later in-app open replaces the slot's content but keeps this page:
// a modal drawn here would stay mounted under the next one.
//
// Resolved here as well as in the slot so the redirect, the 404 dialog and the error
// boundary belong to the page; the slot's own boundaries render nothing.
export default async function ControlPage({
  params,
  searchParams,
}: ControlRouteProps) {
  await resolveControlRoute((await params).id, await searchParams);
  return null;
}
