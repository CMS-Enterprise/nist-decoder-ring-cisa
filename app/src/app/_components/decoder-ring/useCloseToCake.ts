"use client";

import { useRouter } from "next/navigation";

import { useDecoderQuery } from "./useDecoderQuery";

/**
 * Close whatever `/control/[id]` is showing: a navigation to "/" with the current
 * filters. It pushes an entry, so Back reopens what was closed. A double-click still
 * adds one entry: the router does not push the address it is already going to.
 */
export function useCloseToCake(): () => void {
  const router = useRouter();
  const { search } = useDecoderQuery();
  return () => router.push(`/${search}`);
}
