/**
 * Tests for the pure arrangeMountain layout util.
 *
 * arrangeMountain takes families, sorts them descending by control count, then
 * alternates even-index families to the left and odd-index families to the right
 * (right side reversed) so the LARGEST families land on the outer edges and the
 * smallest in the middle — the "mountain" shape the layer cake renders. The
 * function is pure: no mocks needed, and it must not mutate its input.
 */
import { describe, it, expect } from "vitest";

import { arrangeMountain } from "../arrangeMountain";

/** Minimal family shape: arrangeMountain only reads `controls.length`. */
function makeFamily(id: string, count: number) {
  return { id, controls: Array.from({ length: count }, (_, i) => i) };
}

describe("arrangeMountain", () => {
  it("places the largest families on the outer edges and the smallest in the middle", () => {
    // Counts: AC(5), AU(3), AT(1), CM(4), IA(2)
    const families = [
      makeFamily("AC", 5),
      makeFamily("AU", 3),
      makeFamily("AT", 1),
      makeFamily("CM", 4),
      makeFamily("IA", 2),
    ];

    const arranged = arrangeMountain(families);

    // Sorted desc by count: AC(5), CM(4), AU(3), IA(2), AT(1)
    // Even indices (0,2,4) -> left:  AC(5), AU(3), AT(1)
    // Odd indices  (1,3)   -> right: CM(4), IA(2), reversed -> IA(2), CM(4)
    // Final: [AC(5), AU(3), AT(1), IA(2), CM(4)]
    expect(arranged.map((f) => f.id)).toEqual(["AC", "AU", "AT", "IA", "CM"]);

    // The mountain shape: counts decrease toward the center, then increase.
    expect(arranged.map((f) => f.controls.length)).toEqual([5, 3, 1, 2, 4]);
  });

  it("returns a single family unchanged", () => {
    const families = [makeFamily("AC", 3)];

    const arranged = arrangeMountain(families);

    expect(arranged).toHaveLength(1);
    expect(arranged[0]!.id).toBe("AC");
  });

  it("returns an empty array for empty input", () => {
    expect(arrangeMountain([])).toEqual([]);
  });

  it("does not mutate its input array", () => {
    const families = [
      makeFamily("AC", 5),
      makeFamily("AU", 3),
      makeFamily("AT", 1),
    ];
    const original = [...families];

    const arranged = arrangeMountain(families);

    // Input order and identity are preserved; the result is a fresh array.
    expect(families).toEqual(original);
    expect(families.map((f) => f.id)).toEqual(["AC", "AU", "AT"]);
    expect(arranged).not.toBe(families);
  });
});
