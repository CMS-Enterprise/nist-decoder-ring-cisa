import { createHash } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { createLoader, parseAsStringEnum } from "nuqs/server";
import { NextResponse, type NextRequest } from "next/server";

import { writeDocx } from "~/lib/export/docx";
import {
  droppedExportValues,
  EXPORT_FORMATS,
  loadExportSelection,
} from "~/lib/export/selection";
import { writeXlsx } from "~/lib/export/xlsx";
import { createCaller, createExportCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import {
  BuildTimeout,
  BUSY,
  exportCache,
  exportCacheKey,
} from "~/server/export/cache";

const loadFormat = createLoader({
  format: parseAsStringEnum([...EXPORT_FORMATS]).withDefault("xlsx"),
});

const CONTENT_TYPE = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

// Bump when a writer's output changes, so a browser revalidating an old file is sent the new one.
const WRITER_VERSION = "4";

const invalid = (error: string) =>
  NextResponse.json({ error }, { status: 400 });

/** If-None-Match is a list of tags, any of them weak, or `*`. */
const revalidates = (header: string | null, etag: string) =>
  (header ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag.replace(/^W\//, "") === etag);

/**
 * The selection in the query string, as a file. The record comes through the export's
 * own tRPC caller rather than a query of its own, so it passes the procedure's
 * middleware, and this route is the only way to it.
 * Built files are cached and builds capped (~/server/export/cache), since the route is
 * public and the whole catalog is one request away.
 */
export async function GET(request: NextRequest) {
  // Strict, and every list item accounted for: a mistyped value is refused, not exported
  // as something else.
  let format, selection;
  try {
    ({ format } = loadFormat(request, { strict: true }));
    selection = loadExportSelection(request, { strict: true });
  } catch (err) {
    return invalid((err as Error).message.replace(/^\[nuqs\] /, ""));
  }
  const params = request.nextUrl.searchParams;
  const dropped = droppedExportValues(params, selection);
  if (dropped.length > 0) {
    return invalid(`Unrecognised value in ${dropped.join(", ")}.`);
  }
  if (params.get("pick") === "") {
    return invalid("pick is empty; leave it out to export the filtered view.");
  }
  const ctx = await createTRPCContext({ headers: request.headers });
  const caller = createCaller(ctx);
  const exporter = createExportCaller(ctx);
  try {
    const { id: versionId } = await caller.decoder.getActiveVersion();
    const result = await exportCache.get(
      exportCacheKey(versionId, format, selection),
      async () => {
        const record = await exporter.export.getExportRecord(selection);
        const file =
          format === "docx" ? await writeDocx(record) : await writeXlsx(record);
        const slug = record.catalog
          .replace(/[^A-Za-z0-9.]+/g, "-")
          .toLowerCase();
        return {
          file,
          name: `${slug}-export.${format}`,
          // From the record, not the bytes: the XLSX package carries its build time.
          etag: `"${createHash("sha256")
            .update(WRITER_VERSION)
            .update(format)
            .update(JSON.stringify(record))
            .digest("base64url")}"`,
          // The version may have switched since the key was made; never file one under the other.
          cacheable: record.versionId === versionId,
        };
      },
    );
    if (result === BUSY) {
      return NextResponse.json(
        { error: "Too many exports are being built; try again shortly." },
        { status: 429, headers: { "Retry-After": "5" } },
      );
    }
    const caching = {
      "Cache-Control": "public, max-age=300",
      ETag: result.etag,
    };
    if (revalidates(request.headers.get("if-none-match"), result.etag)) {
      return new NextResponse(null, { status: 304, headers: caching });
    }
    return new NextResponse(new Uint8Array(result.file), {
      headers: {
        ...caching,
        "Content-Type": CONTENT_TYPE[format],
        "Content-Disposition": `attachment; filename="${result.name}"`,
      },
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "BAD_REQUEST") {
      return invalid(err.message);
    }
    if (err instanceof BuildTimeout) {
      return NextResponse.json(
        { error: err.message },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
}
