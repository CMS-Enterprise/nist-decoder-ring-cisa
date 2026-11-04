"use client";

import { useRouter } from "next/navigation";

import { api, type RouterOutputs } from "~/trpc/react";
import { controlNumberToOscalId } from "~/lib/control-id";
import ControlModal, { type ModalControl } from "./ControlModal";
import ControlUnavailable from "./ControlUnavailable";
import { controlHref, serializeFilters } from "./filterParams";
import { useCloseToCake } from "./useCloseToCake";
import { useDecoderQuery } from "./useDecoderQuery";

/**
 * The open control's modal, for the control the address names (`/control/AC-02`).
 * Rendered by the @modal slot on an in-app open and by the direct-load page, so both
 * close the same way (useCloseToCake): a navigation to "/" with the current filters,
 * which pushes an entry, so Back reopens the control that was closed. Escape is each
 * dialog's own: this component renders nothing while the data loads, so nothing listens.
 *
 * `detail` is what the server fetched while checking the control exists; the modal
 * starts from it rather than requesting it again.
 */
export default function ControlModalRoute({
  id,
  detail,
}: {
  id: string;
  detail?: RouterOutputs["decoder"]["getControlById"];
}) {
  const close = useCloseToCake();
  const router = useRouter();
  const { query, search } = useDecoderQuery();

  // A cross-reference or a lineage link opens another control at its own address with
  // the current filters, built as the cake builds one, so Back returns to the control the
  // reader came from. Another control's enhancement goes to its own id, which the route
  // redirects to the base with `?enh`, keeping `?item` when a successor names one item.
  const openControl = (controlNumber: string, item?: string) =>
    router.push(controlHref(controlNumber, null, search, item ?? null));

  // A withdrawn control whose successor is a whole family (SA-12 went into SR) ends its
  // chain on the cake, filtered to that family. A push rather than the filters' replace,
  // so Back returns to the withdrawn control.
  const openFamily = (familyCode: string) =>
    router.push(serializeFilters("/", { ...query, family: [familyCode] }));

  // The open control is held by identifier — the URL's — never as a copy of the object.
  //
  // A held copy is a snapshot of whatever the query returned when it was taken, and it does not follow the data afterwards. `staleTime: Infinity` makes that look safe — but invalidation overrides staleTime rather than respecting it, so the first `invalidateQueries` on this key would refetch, replace every control object, and leave an open modal rendering the previous one. Nothing invalidates today; the point is that nothing in such a change would look like it was about the modal.
  //
  // Deriving from the live data costs nothing: the query observer applies structural sharing, so a control that did not change keeps its reference across updates. It is the same cache entry the cake reads, so this issues no request of its own.
  const { data } = api.decoder.getBridgeData.useQuery(undefined, {
    staleTime: Infinity,
  });
  const listed =
    data?.families
      .flatMap((family) => family.controls)
      .find((c) => c.id === id) ?? null;
  // The cake holds live controls only, so a withdrawn control (AC-13) isn't in it. The
  // server already fetched its detail while checking it exists, so the modal opens from
  // that, with the fields the modal reads and nothing standing in for the rest.
  const control: ModalControl | null =
    listed ??
    (detail
      ? {
          id,
          oscalId: controlNumberToOscalId(id),
          name: detail.name,
          status: detail.status,
        }
      : null);

  // Still loading; the cake behind shows its own spinner meanwhile.
  if (!data) return null;

  // Neither the cake nor the server's detail has the control. Say so rather than leave
  // an address that names a control and shows nothing.
  if (!control) {
    return (
      <ControlUnavailable title="This control isn't on the diagram">
        It exists in the catalog but isn&apos;t one the diagram shows, so it
        can&apos;t open here.
      </ControlUnavailable>
    );
  }

  return (
    <ControlModal
      // A new id is a new control: remount, so nothing from the last one (its copied
      // notice, its withdrawn toggle) carries over. The tab and the highlighted item need
      // no reset; they are the new address's ?enh and ?item.
      key={id}
      control={control}
      nistVersion={data.version}
      onClose={close}
      initialDetail={detail}
      onOpenControl={openControl}
      onOpenFamily={openFamily}
    />
  );
}
