import { strToU8, zipSync } from "fflate";

import { NO_METHOD } from "./copy-text";
import {
  cisaLabels,
  frequencyLabel,
  NO_FREQUENCY,
  NO_PRIORITY,
  type ExportControl,
  type ExportRecord,
} from "./record";
import { xml } from "./xml";

/**
 * The DOCX writer, as WordprocessingML text zipped with fflate. A document object model
 * (the `docx` package) held about 250 MB for the whole Standard catalog, past the heap a
 * 512 MB task gives Node, and the server fell over; text needs about 45 MB. Owning the
 * markup means owning its escaping, so every value goes through `xml` and only web links
 * become hyperlinks.
 */

// Word bookmark names: a letter first, then letters, digits and underscores, at most 40.
export const bookmarkFor = (id: string): string =>
  `c_${id.replace(/[^A-Za-z0-9]+/g, "_")}`.slice(0, 40);

// A reference opens in the reader's browser, so only a web address becomes a link. Anything
// else (file:, a UNC path, javascript:) is printed as text, never followed on a click.
const isWebLink = (url: string) => /^https?:\/\//i.test(url.trim());

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  link?: boolean;
}

function run(text: string, style: RunStyle = {}): string {
  const props = [
    style.link ? '<w:rStyle w:val="Hyperlink"/>' : "",
    style.bold ? "<w:b/>" : "",
    style.italic ? "<w:i/>" : "",
  ].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

interface ParagraphStyle {
  style?: string;
  indent?: number;
  pageBreakBefore?: boolean;
  bullet?: boolean;
}

function paragraph(content: string, p: ParagraphStyle = {}): string {
  const props = [
    p.style ? `<w:pStyle w:val="${p.style}"/>` : "",
    p.pageBreakBefore ? "<w:pageBreakBefore/>" : "",
    // numId 1 is the bullet list numbering.xml defines; it carries its own indent.
    p.bullet
      ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
      : "",
    p.indent ? `<w:ind w:left="${p.indent}"/>` : "",
  ].join("");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
}

/** Collects the document's external links as relationships, one per distinct URL. */
class Links {
  private ids = new Map<string, string>();
  external(url: string, label: string): string {
    // A link with no text has no accessible name, so an untitled one reads as its address.
    if (!label.trim()) label = url;
    if (!isWebLink(url)) return run(`${label} (${url})`);
    let id = this.ids.get(url);
    if (!id) {
      id = `rIdL${this.ids.size + 1}`;
      this.ids.set(url, id);
    }
    return `<w:hyperlink r:id="${id}" w:history="1">${run(label, { link: true })}</w:hyperlink>`;
  }
  relationships(): string {
    return [...this.ids]
      .map(
        ([url, id]) =>
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(url)}" TargetMode="External"/>`,
      )
      .join("");
  }
}

const heading = (
  text: string,
  level: 1 | 2 | 3 | 4,
  p: Omit<ParagraphStyle, "style"> = {},
) => paragraph(run(text), { ...p, style: `Heading${level}` });

// Composed statements indent sub-items with two spaces a level; Word gets a real indent.
const textBlock = (text: string) =>
  text.split("\n").map((line) => {
    const depth = (line.length - line.trimStart().length) / 2;
    return paragraph(run(line.trimStart()), {
      indent: depth > 0 ? depth * 360 : undefined,
    });
  });

const labelled = (label: string, text: string) =>
  paragraph(run(`${label}: `, { bold: true }) + (text ? run(text) : ""));

function controlBlock(
  c: ExportControl,
  links: Links,
  n: number,
  nested: boolean,
): string[] {
  const name = bookmarkFor(c.id);
  // An enhancement nests under its base only when the base is in the document, and each
  // part sits a level below its control, so no heading level is skipped.
  const level = nested ? 3 : 2;
  const part = (text: string) => heading(text, nested ? 4 : 3);
  const out = [
    paragraph(
      `<w:bookmarkStart w:id="${n}" w:name="${name}"/>${run(`${c.id} ${c.name}`)}<w:bookmarkEnd w:id="${n}"/>`,
      { style: `Heading${level}` },
    ),
  ];
  for (const line of c.lineage ?? []) out.push(paragraph(run(line)));
  if (c.baselines?.length)
    out.push(labelled("Baselines", c.baselines.join(", ")));
  if (c.priority !== undefined)
    out.push(labelled("Priority", c.priority ?? NO_PRIORITY));
  for (const f of c.frequency ?? []) {
    out.push(
      labelled(`${frequencyLabel(f)} frequency`, f.value ?? NO_FREQUENCY),
    );
  }
  if (c.statement) {
    out.push(part("Statement"), ...textBlock(c.statement.text));
    if (c.statement.discussion) {
      out.push(part("Discussion"), ...textBlock(c.statement.discussion));
    }
  }
  if (
    c.assessment &&
    (c.assessment.objectives.length || c.assessment.methods.length)
  ) {
    out.push(part("Assessment procedures"));
    for (const o of c.assessment.objectives)
      out.push(labelled(o.identifier, o.text));
    for (const m of c.assessment.methods) {
      out.push(labelled(m.method, m.text ?? NO_METHOD));
    }
  }
  if (c.zeroTrust?.length) {
    out.push(part("Zero Trust"));
    for (const t of c.zeroTrust) {
      out.push(
        labelled(
          `${t.pillar} / ${t.function} / ${t.maturity}`,
          cisaLabels(t).join(", "),
        ),
        ...textBlock(t.guidance),
      );
    }
  }
  if (c.references?.length) {
    out.push(part("References"));
    for (const r of c.references) {
      out.push(
        paragraph(
          links.external(r.url, r.label) +
            (r.citation ? run(` — ${r.citation}`) : "") +
            (r.scope === "base" && c.baseId
              ? run(` (from ${c.baseId})`, { italic: true })
              : ""),
          { bullet: true },
        ),
      );
    }
  }
  return out;
}

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

// Word opens a package with no compatibility setting in Compatibility Mode, as a 2007 document.
const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const headingStyle = (level: number, size: number) =>
  `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="48"/></w:rPr></w:style>${headingStyle(1, 36)}${headingStyle(2, 30)}${headingStyle(3, 26)}${headingStyle(4, 22)}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;

/**
 * One section per framework: its title, a contents page linking each control's heading,
 * then the controls, an enhancement's heading a level below its base's when both are in it.
 */
export async function writeDocx(record: ExportRecord): Promise<Buffer> {
  const links = new Links();
  const bases = new Set(record.controls.map((c) => c.id));
  const nested = (c: ExportControl) => !!c.baseId && bases.has(c.baseId);
  const body = [
    paragraph(run(record.catalog), { style: "Title" }),
    heading("Contents", 1),
    ...record.controls.map((c) =>
      paragraph(
        `<w:hyperlink w:anchor="${bookmarkFor(c.id)}" w:history="1">${run(`${c.id} ${c.name}`, { link: true })}</w:hyperlink>`,
        { indent: nested(c) ? 360 : undefined },
      ),
    ),
    heading("Controls", 1, { pageBreakBefore: true }),
    ...record.controls.flatMap((c, i) => controlBlock(c, links, i, nested(c))),
  ].join("");

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(record.catalog)}</dc:title><dc:language>en-US</dc:language></cp:coreProperties>`,
    "word/document.xml": document,
    "word/styles.xml": STYLES,
    "word/numbering.xml": NUMBERING,
    "word/settings.xml": SETTINGS,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${links.relationships()}</Relationships>`,
  };
  // A fixed modification time keeps the package bytes stable for one record.
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    ),
    { level: 6, mtime: new Date("2000-01-01T00:00:00Z") },
  );
  return Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength);
}
