import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import writeXlsxFile, {
  type Sheet,
  type SheetData,
} from "write-excel-file/node";

import {
  aboutRows,
  controlLink,
  corePropertiesXml,
  type ExportMeta,
} from "./about";
import { cisaLabels, type ExportRecord } from "./record";
import { xml } from "./xml";

type Cell = string | null;

export interface ExportSheet {
  name: string;
  header: string[];
  rows: Cell[][];
  /** A line above the header saying what the sheet is for. */
  note?: string;
  /** The column whose web addresses open as links. */
  linkColumn?: number;
  /** A sheet to read rather than sort: no filter on its header. */
  plain?: boolean;
}

/**
 * One worksheet per dataset, each row led by the control's id so sheets join on it.
 * "About" comes first, saying what the file is, then "Controls": the selection itself,
 * one row per control, with a column for each single-valued field chosen and the
 * statement and discussion. Frequency and related controls, having several, get a sheet
 * each.
 */
export function exportSheets(
  record: ExportRecord,
  meta: ExportMeta,
): ExportSheet[] {
  const { controls, datasets, fields } = record;
  const columns: Array<[string, (c: (typeof controls)[number]) => Cell]> = [
    ["Control", (c) => c.id],
    ["OSCAL ID", (c) => c.oscalId],
    ["Name", (c) => c.name],
    ["Family", (c) => c.family],
    ["Base control", (c) => c.baseId],
  ];
  if (fields.includes("baselines"))
    columns.push(["Baselines", (c) => c.baselines?.join(", ") ?? null]);
  if (fields.includes("priority"))
    columns.push(["Priority", (c) => c.priority ?? null]);
  if (fields.includes("lineage"))
    columns.push([
      "Lineage",
      (c) => (c.lineage?.length ? c.lineage.join("\n") : null),
    ]);
  if (datasets.includes("statement"))
    columns.push(
      ["Statement", (c) => c.statement?.text ?? null],
      ["Discussion", (c) => c.statement?.discussion ?? null],
    );
  const { appUrl } = meta;
  if (appUrl) columns.push(["Link", (c) => controlLink(appUrl, c.id)]);
  const sheets: ExportSheet[] = [
    {
      name: "About",
      header: ["About this export", ""],
      rows: aboutRows(record, meta).map((r) => [r.label, r.value]),
      linkColumn: 1,
      plain: true,
    },
    {
      name: "Controls",
      header: columns.map(([h]) => h),
      rows: controls.map((c) => columns.map(([, cell]) => cell(c))),
      ...(appUrl ? { linkColumn: columns.length - 1 } : {}),
    },
  ];
  if (fields.includes("frequency")) {
    sheets.push({
      name: "Frequency",
      header: ["Control", "Source", "Applies to", "Frequency"],
      rows: controls.flatMap((c) =>
        (c.frequency ?? []).map((f) => [
          c.id,
          f.pane === "catalog" ? "Catalog" : "Zero Trust",
          f.label,
          f.value,
        ]),
      ),
    });
  }
  if (fields.includes("related")) {
    sheets.push({
      name: "Related",
      header: ["Control", "Related control", "Name", "In this catalog"],
      rows: controls.flatMap((c) =>
        (c.related ?? []).map((r) => [
          c.id,
          r.id,
          r.name,
          r.name === null ? "No" : "Yes",
        ]),
      ),
    });
  }
  if (datasets.includes("statement")) {
    const parameters = controls.flatMap((c) =>
      (c.statement?.parameters ?? []).flatMap((p) =>
        p.values.map((v) => [c.id, p.label, v.baselines.join(", "), v.value]),
      ),
    );
    // Only when the selection has parameters: a NIST catalog assigns none.
    if (parameters.length) {
      sheets.push({
        name: "Parameters",
        note: "Each organization-defined value, per baseline, in one place: a row for each control's parameter value.",
        header: ["Control", "Parameter", "Baselines", "Value"],
        rows: parameters,
      });
    }
  }
  if (datasets.includes("assessment")) {
    sheets.push({
      name: "Assessment",
      header: ["Control", "Kind", "Identifier", "Text"],
      rows: controls.flatMap((c) => [
        ...(c.assessment?.objectives ?? []).map((o) => [
          c.id,
          "Objective",
          o.identifier,
          o.text,
        ]),
        ...(c.assessment?.methods ?? []).map((m) => [
          c.id,
          m.method,
          null,
          m.text,
        ]),
      ]),
    });
  }
  if (datasets.includes("zeroTrust")) {
    const tuples = controls.flatMap((c) =>
      (c.zeroTrust ?? []).map((t) => ({ id: c.id, t })),
    );
    // CISA's columns only on a line whose mapping carries them.
    const cisa = tuples.some(({ t }) => t.designation !== undefined);
    sheets.push({
      name: "Zero Trust",
      header: [
        "Control",
        "Pillar",
        "Function",
        "Maturity",
        ...(cisa ? ["CISA designation", "If applicable"] : []),
        "Guidance",
      ],
      rows: tuples.map(({ id, t }) => [
        id,
        t.pillar,
        t.function,
        t.maturity,
        ...(cisa
          ? [cisaLabels(t)[0] ?? null, t.ifApplicable ? "Yes" : null]
          : []),
        t.guidance,
      ]),
    });
  }
  if (datasets.includes("references")) {
    const refs = controls.flatMap((c) =>
      (c.references ?? []).map((r) => ({ c, r })),
    );
    // A Citation column only when some reference in the selection carries one.
    const cited = refs.some(({ r }) => r.citation);
    sheets.push({
      name: "References",
      header: [
        "Control",
        "Pane",
        "Title",
        "URL",
        ...(cited ? ["Citation"] : []),
        "Inherited from",
      ],
      rows: refs.map(({ c, r }) => [
        c.id,
        r.pane === "catalog" ? "Catalog" : "Zero Trust",
        r.label,
        r.url,
        ...(cited ? [r.citation] : []),
        r.scope === "base" ? c.baseId : null,
      ]),
    });
  }
  return sheets.map((s) => ({ ...s, rows: s.rows.map((r) => r.map(fitCell)) }));
}

/** Excel's cap on one cell; past it Excel truncates or "repairs" the file on open. */
export const EXCEL_CELL_LIMIT = 32_767;

/** Cuts a value past Excel's cap and says so in the cell, never silently. */
export function fitCell(value: Cell): Cell {
  if (value === null || value.length <= EXCEL_CELL_LIMIT) return value;
  const note = ` [Cut at Excel's ${EXCEL_CELL_LIMIT.toLocaleString("en-US")}-character cell limit from ${value.length.toLocaleString("en-US")} characters.]`;
  // Never end on half of a surrogate pair.
  const kept = value
    .slice(0, EXCEL_CELL_LIMIT - note.length)
    .replace(/[\uD800-\uDBFF]$/, "");
  return kept + note;
}

// Column widths in characters: fitted to the longest line, within these bounds.
const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

/** Each column's width, and whether its text wraps because it is wider than that. */
export function columnLayout(
  sheet: ExportSheet,
): Array<{ width: number; wrap: boolean }> {
  return sheet.header.map((h, i) => {
    let longest = 0;
    let multiline = false;
    for (const row of sheet.rows) {
      const v = row[i];
      if (!v) continue;
      for (const line of v.split(/\r?\n/))
        longest = Math.max(longest, line.length);
      multiline ||= v.includes("\n");
    }
    // The header gets two more characters, for the filter button Excel draws over its end.
    const width = Math.min(
      Math.max(longest + 2, h.length + 4, MIN_WIDTH),
      MAX_WIDTH,
    );
    return { width, wrap: multiline || longest + 2 > MAX_WIDTH };
  });
}

// Excel's default line height for 11-point Calibri, and its cap on one row.
const LINE_HEIGHT = 15;
const MAX_ROW_HEIGHT = 409;

/**
 * A row's height in points, or undefined for one line. Excel for the web does not size
 * wrapped rows on open, so the file carries an estimate: a character per unit of column
 * width, which errs tall for proportional text rather than clipping it.
 */
export function rowHeight(
  row: Cell[],
  layout: Array<{ width: number; wrap: boolean }>,
): number | undefined {
  let lines = 1;
  row.forEach((v, i) => {
    if (!v || !layout[i]!.wrap) return;
    const width = layout[i]!.width;
    const n = v
      .split(/\r?\n/)
      .reduce(
        (sum, line) => sum + Math.max(1, Math.ceil(line.length / width)),
        0,
      );
    lines = Math.max(lines, n);
  });
  return lines > 1 ? Math.min(lines * LINE_HEIGHT, MAX_ROW_HEIGHT) : undefined;
}

// Excel opens a link of at most 2,079 characters; a longer address stays text.
const MAX_LINK = 2_079;
/** Whether a cell in a sheet's link column becomes a link: a web address Excel can open. */
const opensAsLink = (s: ExportSheet, i: number, value: string) =>
  i === s.linkColumn && /^https?:\/\//i.test(value) && value.length <= MAX_LINK;

export async function writeXlsx(
  record: ExportRecord,
  meta: ExportMeta,
): Promise<Buffer> {
  const exported = exportSheets(record, meta);
  const sheets: Sheet<Buffer>[] = exported.map((s) => {
    const layout = columnLayout(s);
    // Top-aligned, so a row a wrapped cell makes tall still reads from its first line.
    const rows: SheetData = s.rows.map((r) => {
      const height = rowHeight(r, layout);
      return r.map((value, i) => {
        if (value === null) return null;
        const style = {
          alignVertical: "top",
          wrap: layout[i]!.wrap,
          height,
        } as const;
        // The address stays the cell's text, so a viewer that opens no links still shows it.
        return opensAsLink(s, i, value)
          ? {
              ...style,
              value,
              textColor: "#0563C1",
              textDecoration: { underline: true as const },
            }
          : { ...style, value };
      });
    });
    return {
      sheet: s.name,
      stickyRowsCount: s.note ? 2 : 1,
      columns: layout.map(({ width }) => ({ width })),
      data: [
        ...(s.note ? [[{ value: s.note, fontStyle: "italic" as const }]] : []),
        s.header.map((h) => ({ value: h, fontWeight: "bold" as const })),
        ...rows,
      ],
    };
  });
  return finishPackage(
    await writeXlsxFile(sheets).toBuffer(),
    exported,
    record,
    meta,
  );
}

/** "A" for column 1, "AA" for column 27. */
const columnLetter = (n: number): string =>
  (n > 26 ? columnLetter(Math.floor((n - 1) / 26)) : "") +
  String.fromCharCode(65 + ((n - 1) % 26));

/**
 * What `write-excel-file` cannot write: a filter on each header row, the rows down to it
 * repeated on every printed page, each link column's links, and the document's title and
 * date. Sheet N of the package is the Nth sheet.
 */
export function finishPackage(
  xlsx: Buffer,
  sheets: ExportSheet[],
  record: ExportRecord,
  meta: ExportMeta,
): Buffer {
  const parts = unzipSync(new Uint8Array(xlsx));
  const text = (path: string) => strFromU8(parts[path]!);
  const names: string[] = [];
  sheets.forEach((s, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const last = columnLetter(s.header.length);
    const head = s.note ? 2 : 1;
    const rows = s.rows.length + head;
    const ref = `'${xml(s.name.replace(/'/g, "''"))}'`;
    const column = s.linkColumn;
    const links =
      column === undefined
        ? []
        : s.rows.flatMap((r, row) => {
            const url = r[column];
            return url && opensAsLink(s, column, url)
              ? [{ cell: `${columnLetter(column + 1)}${row + head + 1}`, url }]
              : [];
          });
    if (links.length) {
      // Hyperlinks close the worksheet: nothing the library writes follows the filter.
      parts[path] = strToU8(
        text(path).replace(
          "</worksheet>",
          `<hyperlinks>${links.map((l, n) => `<hyperlink ref="${l.cell}" r:id="rIdX${n + 1}"/>`).join("")}</hyperlinks></worksheet>`,
        ),
      );
      const rels = `xl/worksheets/_rels/sheet${i + 1}.xml.rels`;
      parts[rels] = strToU8(
        text(rels).replace(
          "</Relationships>",
          `${links.map((l, n) => `<Relationship Id="rIdX${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(l.url)}" TargetMode="External"/>`).join("")}</Relationships>`,
        ),
      );
    }
    if (!s.plain) {
      // An autoFilter follows sheetData directly; nothing the library writes sits between.
      parts[path] = strToU8(
        text(path).replace(
          "</sheetData>",
          `</sheetData><autoFilter ref="A${head}:${last}${rows}"/>`,
        ),
      );
      names.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${ref}!$A$${head}:$${last}$${rows}</definedName>`,
      );
    }
    names.push(
      `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${ref}!$1:$${head}</definedName>`,
    );
  });
  parts["xl/workbook.xml"] = strToU8(
    text("xl/workbook.xml").replace(
      "<definedNames/>",
      `<definedNames>${names.join("")}</definedNames>`,
    ),
  );
  parts["docProps/core.xml"] = strToU8(corePropertiesXml(record, meta));
  parts["[Content_Types].xml"] = strToU8(
    text("[Content_Types].xml").replace(
      "</Types>",
      '<Override ContentType="application/vnd.openxmlformats-package.core-properties+xml" PartName="/docProps/core.xml"/></Types>',
    ),
  );
  parts["_rels/.rels"] = strToU8(
    text("_rels/.rels").replace(
      "</Relationships>",
      '<Relationship Id="rId-core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    ),
  );
  const zipped = zipSync(parts, { level: 6 });
  return Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength);
}
