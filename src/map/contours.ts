// Marching squares: iso-lines through a grid of values (used for elevation contours and the safe-zone edge).
// Output is in grid units where (0, 0) is the centre of the first cell; multiply by cellM and add cellM/2 for metres.

export type Segment = [number, number, number, number];

/** Line segments where `values` crosses `level`. Cells with non-finite values are skipped. */
export function contourSegments(values: ArrayLike<number>, cols: number, rows: number, level: number): Segment[] {
  const out: Segment[] = [];
  const v = (c: number, r: number) => values[r * cols + c];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = v(c, r), b = v(c + 1, r), d = v(c, r + 1), e = v(c + 1, r + 1); // a b / d e
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(d) || !Number.isFinite(e)) continue;
      const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (e >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const t = (p: number, q: number) => (level - p) / (q - p);
      const top: [number, number] = [c + t(a, b), r];
      const right: [number, number] = [c + 1, r + t(b, e)];
      const bottom: [number, number] = [c + t(d, e), r + 1];
      const left: [number, number] = [c, r + t(a, d)];
      const seg = (p: [number, number], q: [number, number]) => out.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(left, top); break;
        case 5: seg(left, top); seg(bottom, right); break;
        case 10: seg(top, right); seg(left, bottom); break;
      }
    }
  }
  return out;
}
