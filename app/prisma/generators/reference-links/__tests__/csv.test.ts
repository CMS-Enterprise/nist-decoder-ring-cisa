import { describe, expect, it } from "vitest";
import { csvField, parseCsv, parseCsvRecords, toCsv } from "../lib/csv.js";

describe("parseCsv", () => {
  it("splits plain fields and rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("honours quoted commas, doubled quotes and embedded newlines", () => {
    expect(parseCsv('x,"a,b","say ""hi""","two\nlines"\n')).toEqual([
      ["x", "a,b", 'say "hi"', "two\nlines"],
    ]);
  });

  it("ignores carriage returns and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a,,c\n")).toEqual([["a", "", "c"]]);
  });
});

describe("parseCsvRecords", () => {
  it("keys fields by the header and pads short rows", () => {
    expect(
      parseCsvRecords("url,status\nhttps://a.gov,206\nhttps://b.gov\n"),
    ).toEqual([
      { url: "https://a.gov", status: "206" },
      { url: "https://b.gov", status: "" },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });
});

describe("toCsv", () => {
  it("round-trips through parseCsv", () => {
    const text = toCsv(
      ["a", "b"],
      [
        ["1,2", 'q"q'],
        [null, 3],
      ],
    );
    expect(text).toBe('a,b\n"1,2","q""q"\n,3\n');
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1,2", 'q"q'],
      ["", "3"],
    ]);
  });

  it("csvField quotes only when needed", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField(undefined)).toBe("");
  });
});
