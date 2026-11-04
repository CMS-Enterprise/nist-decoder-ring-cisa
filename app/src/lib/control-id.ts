/**
 * The spellings of a control's identity, and the steps between them.
 *
 * The catalog names a control by its OSCAL id (`ac-17.1`) in every internal
 * anchor and by its zero-padded display number (`AC-17(01)`) in every label the
 * seed carries. The page opens a control by the first; the API returns the
 * second on each detail.
 *
 * People and other tools also type a control as "ac-2", "AC2", "ac 2 (1)" or the
 * OSCAL "ac-2.1". The control route accepts any of those and redirects to the stored
 * form, so each control has one address and a link typed by hand still lands.
 * Pure; covered by control-id.test.ts.
 */

const OSCAL_CONTROL_ID = /^([a-z]{2})-(\d+)(?:\.(\d+))?$/i;
const CONTROL_NUMBER = /^([a-z]{2})-(\d+)(?:\((\d+)\))?$/i;
const ID_PATTERN =
  /^([a-z]{2})[\s-]?0*(\d{1,2})\s*(?:\(\s*0*(\d{1,2})\s*\)|[.\s-]\s*0*(\d{1,2}))?$/i;

const pad = (n: string) => n.padStart(2, "0");

/**
 * Longer than any spelling of a real ID, even a spaced-out "AC - 02 ( 01 )". Checked
 * before the pattern runs: its runs of optional whitespace backtrack in quadratic time,
 * and a path segment can be several kilobytes long.
 */
const MAX_LENGTH = 24;

/** True when an anchor target names a control rather than a family or a resource. */
export function isControlId(target: string): boolean {
  return OSCAL_CONTROL_ID.test(target.trim());
}

/** `ac-2` → `AC-02`; `ac-17.1` → `AC-17(01)`; anything else → null. */
export function oscalIdToControlNumber(oscalId: string): string | null {
  const m = OSCAL_CONTROL_ID.exec(oscalId.trim());
  if (!m) return null;
  const base = `${m[1]!.toUpperCase()}-${pad(m[2]!)}`;
  return m[3] ? `${base}(${pad(m[3])})` : base;
}

/** `AC-02` → `ac-2`; `AC-17(01)` → `ac-17.1`; a family code or anything else → null. */
export function controlNumberToOscalId(controlNumber: string): string | null {
  const m = CONTROL_NUMBER.exec(controlNumber.trim());
  if (!m) return null;
  const base = `${m[1]!.toLowerCase()}-${Number(m[2])}`;
  return m[3] ? `${base}.${Number(m[3])}` : base;
}

/** The base control's id for any control id: `ac-17.1` → `ac-17`. */
export function baseControlId(oscalId: string): string {
  return oscalId.trim().split(".")[0]!;
}

/** The stored form of a typed control ID, or null when the text is not one. */
export function normalizeControlId(input: string): string | null {
  if (input.length > MAX_LENGTH) return null;
  const m = ID_PATTERN.exec(input.trim());
  if (!m) return null;
  const [, family, base, enhParen, enhDot] = m;
  const enh = enhParen ?? enhDot;
  const id = `${family!.toUpperCase()}-${pad(base!)}`;
  return enh ? `${id}(${pad(enh)})` : id;
}

/** "AC-02(01)" → { base: "AC-02", enhancement: "01" }; a base ID has no enhancement. */
export function splitControlId(id: string): {
  base: string;
  enhancement: string | null;
} {
  const m = /^(.*?)\((\d+)\)$/.exec(id);
  return m
    ? { base: m[1]!, enhancement: m[2]! }
    : { base: id, enhancement: null };
}
