// One pass: the markup characters escaped, and what XML 1.0 cannot hold at all (most C0
// controls, U+FFFE, U+FFFF and an unpaired surrogate) dropped, since Word and Excel refuse the file.
const ESCAPED: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
export const xml = (text: string) =>
  text.replace(
    /[&<>"]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    (ch) => ESCAPED[ch] ?? "",
  );
