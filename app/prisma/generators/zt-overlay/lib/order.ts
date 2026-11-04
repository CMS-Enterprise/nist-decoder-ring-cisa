// Docs: prisma/generators/zt-overlay/README.md
/**
 * Orderings that come out the same on every machine. `localeCompare` orders by
 * the process's locale, which Node takes from `LANG` / `LC_ALL`, so a generator
 * sorting with it can write different files from the same inputs on another
 * machine. Everything this generator sorts goes through these instead.
 */

/** Strings by UTF-16 code unit. */
export const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** Lists of numbers, element by element; a list that is a prefix of another sorts first. */
export function compareNumberLists(
  a: readonly number[],
  b: readonly number[],
): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
