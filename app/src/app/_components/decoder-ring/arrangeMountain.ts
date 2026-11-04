/**
 * Mountain layout for the layer cake: largest families on the outside, smallest in
 * the middle. Pure + deterministic — extracted from the old server-side sort so the
 * arrangement is a client concern. Computed once from the full set at load (frozen),
 * so filtering dims/removes controls without ever reshuffling family positions.
 */
export function arrangeMountain<T extends { controls: unknown[] }>(
  families: readonly T[],
): T[] {
  const sorted = [...families].sort(
    (a, b) => b.controls.length - a.controls.length,
  );
  const left: T[] = [];
  const right: T[] = [];
  sorted.forEach((family, index) => {
    if (index % 2 === 0) left.push(family);
    else right.push(family);
  });
  // Reverse the right side so the largest families land on the outer edges.
  right.reverse();
  return [...left, ...right];
}
