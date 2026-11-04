// Docs: prisma/generators/zt-overlay/README.md
/**
 * A minimal, read-only reader for one worksheet of an .xlsx workbook.
 *
 * The workbook is an outside document, so it is read as data and nothing more:
 * only the four parts a sheet's values need are inflated (the workbook, its
 * relationships, the shared strings and the sheet itself), each under a size
 * cap; a part declaring a DTD is refused before it reaches the XML parser, so
 * no entity it defines is ever expanded; formulas are never evaluated, and a
 * formula cell yields the value the workbook cached for it. External links,
 * document properties and embedded media are never opened.
 *
 * Values come back as the strings the workbook stores. Numbers are not parsed,
 * so a code written "0101" stays "0101".
 */

import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

/** The largest part this reader will inflate. The mapping sheet is about 400 KB. */
export const MAX_PART_BYTES = 16 * 1024 * 1024;

export interface Cell {
  /** The cell's value as stored, or "" for an empty cell. */
  value: string;
  /** True when the cell holds a formula; `value` is the cached result. */
  formula: boolean;
}

/** One worksheet: row number → column letters → cell. */
export type Sheet = Map<number, Map<string, Cell>>;

const WORKBOOK = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS = "xl/sharedStrings.xml";

const ARRAY_TAGS = new Set(["sheet", "Relationship", "si", "r", "row", "c"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

type Node = Record<string, unknown>;

function parseXml(name: string, bytes: Uint8Array): Node {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE/i.test(text)) {
    throw new Error(`Refusing ${name}: it declares a DTD.`);
  }
  return parser.parse(text) as Node;
}

function asArray(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Node[];
}

/** The text of a `<t>` element, which parses as a string, or as an object when
 *  it carries `xml:space`, or as "" when it is empty. */
function textOf(t: unknown): string {
  if (typeof t === "string") return t;
  if (t !== null && typeof t === "object") return attr(t as Node, "#text", "");
  return "";
}

/** An attribute or text value, which the parser leaves as a string. */
function attr(node: Node, name: string, fallback: string): string {
  const v = node[name];
  return typeof v === "string" || typeof v === "number" ? String(v) : fallback;
}

/** A shared or inline string: plain `<t>`, or rich text as a run of `<r><t>`.
 *  Phonetic runs (`<rPh>`) are reading aids, not content, and are skipped. */
function stringItem(si: Node): string {
  if ("t" in si) return textOf(si.t);
  return asArray(si.r)
    .map((run) => textOf(run.t))
    .join("");
}

/** "AB12" → ["AB", 12]. */
export function splitRef(ref: string): [string, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m)
    throw new Error(`Unrecognised cell reference ${JSON.stringify(ref)}.`);
  return [m[1]!, Number(m[2])];
}

/** The path of a sheet's part, from its relationship target. Targets are
 *  relative to `xl/` unless they start with "/". */
function sheetPath(target: string): string {
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  if (!/^xl\/worksheets\/[A-Za-z0-9_]+\.xml$/.test(path)) {
    throw new Error(`Unexpected worksheet location ${JSON.stringify(target)}.`);
  }
  return path;
}

function inflate(bytes: Uint8Array, wanted: (name: string) => boolean) {
  const parts = unzipSync(bytes, {
    filter: (file) => {
      if (!wanted(file.name)) return false;
      if (file.originalSize > MAX_PART_BYTES) {
        throw new Error(
          `Refusing ${file.name}: ${file.originalSize} bytes exceeds the ${MAX_PART_BYTES}-byte cap.`,
        );
      }
      return true;
    },
  });
  for (const [name, data] of Object.entries(parts)) {
    // The declared size is the archive's own claim; check what actually came out.
    if (data.length > MAX_PART_BYTES) {
      throw new Error(`Refusing ${name}: inflated past the size cap.`);
    }
  }
  return parts;
}

/** Read one named worksheet's cell values. */
export function readSheet(bytes: Uint8Array, sheetName: string): Sheet {
  const index = inflate(bytes, (n) => n === WORKBOOK || n === WORKBOOK_RELS);
  if (!index[WORKBOOK] || !index[WORKBOOK_RELS]) {
    throw new Error("Not an xlsx workbook: the workbook part is missing.");
  }

  const workbook = parseXml(WORKBOOK, index[WORKBOOK]).workbook as Node;
  const sheets = asArray((workbook?.sheets as Node | undefined)?.sheet);
  const entry = sheets.find((s) => s["@_name"] === sheetName);
  if (!entry) {
    const names = sheets.map((s) => attr(s, "@_name", "?")).join(", ");
    throw new Error(
      `No sheet named "${sheetName}"; the workbook has: ${names}.`,
    );
  }
  const relId = attr(entry, "@_r:id", "");

  const rels = parseXml(WORKBOOK_RELS, index[WORKBOOK_RELS])
    .Relationships as Node;
  const rel = asArray(rels?.Relationship).find((r) => r["@_Id"] === relId);
  if (!rel)
    throw new Error(`Sheet "${sheetName}" has no relationship ${relId}.`);
  const target = sheetPath(attr(rel, "@_Target", ""));

  const parts = inflate(bytes, (n) => n === target || n === SHARED_STRINGS);
  if (!parts[target])
    throw new Error(`The part for sheet "${sheetName}" is missing.`);

  const shared = parts[SHARED_STRINGS]
    ? asArray(
        (parseXml(SHARED_STRINGS, parts[SHARED_STRINGS]).sst as Node)?.si,
      ).map(stringItem)
    : [];

  const worksheet = parseXml(target, parts[target]).worksheet as Node;
  const rows = asArray((worksheet?.sheetData as Node | undefined)?.row);

  const sheet: Sheet = new Map();
  for (const row of rows) {
    for (const c of asArray(row.c)) {
      const ref = attr(c, "@_r", "");
      const [col, rowNumber] = splitRef(ref);
      const type = attr(c, "@_t", "n");
      const raw = textOf(c.v);
      let value: string;
      if (type === "s") {
        const i = Number(raw);
        if (raw === "" || !Number.isInteger(i) || shared[i] === undefined) {
          throw new Error(
            `Cell ${ref} points at a shared string that does not exist.`,
          );
        }
        value = shared[i];
      } else if (type === "inlineStr") {
        value = stringItem((c.is as Node | undefined) ?? {});
      } else {
        value = raw;
      }
      const cells = sheet.get(rowNumber) ?? new Map<string, Cell>();
      cells.set(col, { value, formula: "f" in c });
      sheet.set(rowNumber, cells);
    }
  }
  return sheet;
}

/** A cell's value, or "" when the cell is absent. */
export function cellValue(sheet: Sheet, col: string, row: number): string {
  return sheet.get(row)?.get(col)?.value ?? "";
}
