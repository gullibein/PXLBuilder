/**
 * The largest and the smallest of a number taken from each thing in a list, for a list of any length.
 * `Math.max(...list.map(of))` gives the same answer until the list is long: a call takes every item as an argument,
 * and a level of some 125,000 things has more than a call can hold (it throws). Like Math.max and Math.min: an
 * empty list gives -Infinity and Infinity, and one value that is not a number makes the answer not a number.
 */
export function most<T>(list: readonly T[], of: (x: T) => number): number {
  let m = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const v = of(list[i]);
    if (v !== v) return NaN;
    if (v > m) m = v;
  }
  return m;
}

export function least<T>(list: readonly T[], of: (x: T) => number): number {
  let m = Infinity;
  for (let i = 0; i < list.length; i++) {
    const v = of(list[i]);
    if (v !== v) return NaN;
    if (v < m) m = v;
  }
  return m;
}
