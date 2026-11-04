import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { cellValue, readSheet, splitRef } from "../lib/xlsx";

const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function workbook(parts: Record<string, string>): Uint8Array {
  const base: Record<string, string> = {
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Notes" sheetId="1" r:id="rId1"/><sheet name="Mapping" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst ${NS}><si><t>Control ID</t></si><si><t xml:space="preserve">AC-2 </t></si><si><r><t>Rich </t></r><r><t>text &amp; more</t></r><rPh><t>reading</t></rPh></si></sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet ${NS}><sheetData/></worksheet>`,
    "xl/worksheets/sheet2.xml": `<?xml version="1.0"?><worksheet ${NS}><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="AA1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>inline</t></is></c><c r="C2"><v>0101</v></c><c r="D2" t="str"><f>A2&amp;"x"</f><v>AC-2 x</v></c><c r="E2" s="3"/></row>
    </sheetData></worksheet>`,
  };
  const all = { ...base, ...parts };
  return zipSync(
    Object.fromEntries(Object.entries(all).map(([k, v]) => [k, strToU8(v)])),
  );
}

describe("readSheet", () => {
  const sheet = readSheet(workbook({}), "Mapping");

  it("reads shared, rich, inline and numeric cells as stored strings", () => {
    expect(cellValue(sheet, "A", 1)).toBe("Control ID");
    expect(cellValue(sheet, "A", 2)).toBe("AC-2 ");
    expect(cellValue(sheet, "AA", 1)).toBe("Rich text & more");
    expect(cellValue(sheet, "B", 2)).toBe("inline");
    expect(cellValue(sheet, "C", 2)).toBe("0101");
    expect(cellValue(sheet, "E", 2)).toBe("");
    expect(cellValue(sheet, "Z", 9)).toBe("");
  });

  it("returns a formula's cached value and marks it", () => {
    expect(sheet.get(2)?.get("D")).toEqual({ value: "AC-2 x", formula: true });
    expect(sheet.get(2)?.get("A")?.formula).toBe(false);
  });

  it("finds the sheet by name, not position", () => {
    expect(readSheet(workbook({}), "Notes").size).toBe(0);
    expect(() => readSheet(workbook({}), "Missing")).toThrow(
      /No sheet named "Missing".*Notes, Mapping/,
    );
  });

  it("refuses a part that declares a DTD", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaa">]><sst ${NS}><si><t>&a;</t></si></sst>`;
    expect(() =>
      readSheet(workbook({ "xl/sharedStrings.xml": bomb }), "Mapping"),
    ).toThrow(/declares a DTD/);
  });

  it("refuses a shared-string index that does not exist", () => {
    const sheet2 = `<?xml version="1.0"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>99</v></c></row></sheetData></worksheet>`;
    expect(() =>
      readSheet(workbook({ "xl/worksheets/sheet2.xml": sheet2 }), "Mapping"),
    ).toThrow(/shared string that does not exist/);
  });

  it("refuses a worksheet target outside the worksheets folder", () => {
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Target="../../etc/x.xml"/></Relationships>`;
    expect(() =>
      readSheet(workbook({ "xl/_rels/workbook.xml.rels": rels }), "Mapping"),
    ).toThrow(/Unexpected worksheet location/);
  });

  it("refuses something that is not a workbook", () => {
    const zip = zipSync({ "readme.txt": strToU8("hello") });
    expect(() => readSheet(zip, "Mapping")).toThrow(/Not an xlsx workbook/);
  });
});

describe("splitRef", () => {
  it("splits a cell reference", () => {
    expect(splitRef("AB12")).toEqual(["AB", 12]);
    expect(() => splitRef("12AB")).toThrow(/Unrecognised cell reference/);
  });
});
