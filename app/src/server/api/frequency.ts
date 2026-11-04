/** A control's frequencies, read from its statement: NIST leaves each one organization-defined,
 *  as an "[Assignment: organization-defined frequency]" placeholder in the seeded prose. */

export interface FrequencyParameter {
  /** The part the parameter sits in, as "(c)(1)"; null at the root statement. */
  part: string | null;
  /** The words leading into the parameter, other placeholders shown as their plain wording. */
  before: string;
  /** The parameter as the catalog words it, e.g. "organization-defined frequency". */
  parameter: string;
  /** The words following it, to the end of its clause. */
  after: string;
}

export interface FrequencyInfo {
  nist: FrequencyParameter[];
}

interface PartLike {
  label: string | null;
  prose: string | null;
  children: PartLike[];
}

const HAS_PLACEHOLDER = /\[Assignment:\s*organization-defined[^\]]*?frequenc/i;
const PLACEHOLDER =
  /\[Assignment:\s*(organization-defined[^\]]*?frequenc(?:y|ies)[^\]]*)\]/gi;
const SPAN = /\[(Assignment|Selection[^:\]]*):\s*([^[\]]*?)\s*\]/i;
const BEFORE_WORDS = 14;
const AFTER_WORDS = 12;
/** Cap on the whole lead-in once a parent part's wording is joined to the part's own. */
const LEAD_WORDS = 16;

function lastWords(text: string, n: number): string {
  const words = text.split(" ").filter(Boolean);
  return words.length > n ? `… ${words.slice(-n).join(" ")}` : words.join(" ");
}

function labelSegment(label: string | null): string {
  const bare = (label ?? "").replace(/[.\s()]/g, "");
  return bare ? `(${bare})` : "";
}

/**
 * Replace each closed [Assignment: x] or [Selection: a; b] span with its wording, innermost
 * first. A selection's options read as a choice, "a or b", rather than the catalog's list.
 */
function flatten(text: string): string {
  let out = text;
  for (let m = SPAN.exec(out); m; m = SPAN.exec(out)) {
    const wording = /^selection/i.test(m[1]!)
      ? m[2]!.split(/\s*;\s*/).join(" or ")
      : m[2]!;
    out = out.slice(0, m.index) + wording + out.slice(m.index + m[0].length);
  }
  return out.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
}

/** Index of the last "[" left open in `text`, or -1. */
function lastOpenBracket(text: string): number {
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[") open.push(i);
    else if (text[i] === "]") open.pop();
  }
  return open.length ? open[open.length - 1]! : -1;
}

/** The clause before a placeholder; inside a selection, the outside text plus that option's own words. */
function leadIn(before: string): string {
  const open = lastOpenBracket(before);
  const outside = open >= 0 ? before.slice(0, open) : before;
  const option =
    open >= 0
      ? before
          .slice(open)
          .replace(/^\[Selection[^:\]]*:/i, "")
          .split(";")
          .pop()!
      : "";
  const clause = flatten(`${outside} ${option}`)
    .split(/\.\s+/)
    .pop()!
    .replace(/[\s,;:]+$/, "");
  return lastWords(clause, BEFORE_WORDS);
}

/** The words after a placeholder, to the end of its clause or of the selection it sits in. */
function leadOut(after: string): string {
  let depth = 0;
  let end = after.length;
  for (let i = 0; i < after.length; i++) {
    const c = after[i]!;
    if (c === "[") depth++;
    else if (c === "]") {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    } else if (
      depth === 0 &&
      (c === ";" || (c === "." && /\s|$/.test(after[i + 1] ?? "")))
    ) {
      end = i;
      break;
    }
  }
  const words = flatten(after.slice(0, end))
    .replace(/[\s,:]+$/, "")
    .split(" ")
    .filter(Boolean);
  return words.length > AFTER_WORDS
    ? `${words.slice(0, AFTER_WORDS).join(" ")} …`
    : words.join(" ");
}

export function frequencyFromParts(parts: PartLike[]): FrequencyInfo {
  const nist: FrequencyParameter[] = [];
  const visit = (part: PartLike, path: string, parentProse: string) => {
    const here = path + labelSegment(part.label);
    const prose = part.prose ?? "";
    for (const m of prose.matchAll(PLACEHOLDER)) {
      const own = leadIn(prose.slice(0, m.index));
      const parent = flatten(parentProse).replace(/[:\s]+$/, "");
      nist.push({
        part: here || null,
        // A trimmed lead-in keeps its ellipsis; joined to the parent's wording, the whole is re-trimmed.
        before: parent
          ? lastWords(`${parent}: ${own.replace(/^… /, "")}`, LEAD_WORDS)
          : own,
        parameter: m[1]!.trim(),
        after: leadOut(prose.slice(m.index + m[0].length)),
      });
    }
    for (const child of part.children) {
      visit(child, here, prose && !HAS_PLACEHOLDER.test(prose) ? prose : "");
    }
  };
  for (const p of parts) visit(p, "", "");
  return { nist };
}
