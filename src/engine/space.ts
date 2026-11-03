// An occupancy grid over the picture. Cells are blocked by text, outside
// the allowed region, or by elements already placed; queries answer how
// much free room surrounds a point.
import type { Pt } from "./geom.ts";

// A cell's state.
export const FREE = 0, OUTSIDE = 1, TEXT = 2, PLACED = 3, CORRIDOR = 4;

export class Space {
  readonly w: number;
  readonly h: number;
  readonly c: number;
  readonly nx: number;
  readonly ny: number;
  // Cell (i, j) is v[j * nx + i].
  readonly v: number[] = [];
  // The clearance field (pt per cell) and its largest value, after field().
  f: number[] | undefined;
  maxf = 0;

  // A grid of `cell`-pt cells over width x height pt, every cell outside
  // until open() marks where flora may grow.
  constructor(width: number, height: number, cell = 3) {
    this.w = width;
    this.h = height;
    this.c = cell;
    this.nx = Math.ceil(width / cell);
    this.ny = Math.ceil(height / cell);
    for (let k = 0; k < this.nx * this.ny; k++) this.v.push(OUTSIDE);
  }

  private setRect(x0: number, y0: number, x1: number, y1: number, val: number): void {
    const c = this.c;
    const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(this.nx - 1, Math.ceil(x1 / c) - 1);
    const j0 = Math.max(0, Math.floor(y0 / c)), j1 = Math.min(this.ny - 1, Math.ceil(y1 / c) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.v[j * this.nx + i] = val;
  }

  open(x0: number, y0: number, x1: number, y1: number): void {
    this.setRect(x0, y0, x1, y1, FREE);
  }
  blockText(x0: number, y0: number, x1: number, y1: number): void {
    this.setRect(x0, y0, x1, y1, TEXT);
  }
  close(x0: number, y0: number, x1: number, y1: number): void {
    this.setRect(x0, y0, x1, y1, OUTSIDE);
  }

  // The state of the cell at (x, y), or undefined off the grid.
  private cell(x: number, y: number): number | undefined {
    const i = Math.floor(x / this.c), j = Math.floor(y / this.c);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return undefined;
    return this.v[j * this.nx + i];
  }

  // Is the cell at (x, y) free? With `overStems`, stem corridors count too.
  free(x: number, y: number, overStems = false): boolean {
    const v = this.cell(x, y);
    return v === FREE || (overStems && v === CORRIDOR);
  }

  textAt(x: number, y: number): boolean {
    return this.cell(x, y) === TEXT;
  }

  // Inside the growing region and clear of text? Placed elements do not
  // count, so stems may pass under leaves.
  openAt(x: number, y: number): boolean {
    const v = this.cell(x, y);
    return v === FREE || v === PLACED || v === CORRIDOR;
  }

  // The radius of the largest free disc centred at (x, y), up to maxr.
  // With `overStems`, stem corridors count as free (for leaves, painted over
  // stems).
  clearance(x: number, y: number, maxr: number, overStems = false): number {
    if (!this.free(x, y, overStems)) return 0;
    const c = this.c, nx = this.nx, ny = this.ny, v = this.v;
    const ci = Math.floor(x / c), cj = Math.floor(y / c);
    const rings = Math.ceil(maxr / c);
    // Square rings are scanned outward; a blocked cell in ring r lies at
    // least r cells away, so once r cells exceed the best distance, stop.
    let best = maxr + c;
    const probe = (di: number, dj: number) => {
      const d = Math.sqrt(di * di + dj * dj) * c;
      if (d < best) {
        const i = ci + di, j = cj + dj;
        const cv = i >= 0 && j >= 0 && i < nx && j < ny ? v[j * nx + i] : undefined;
        if (cv === undefined || (cv !== FREE && !(overStems && cv === CORRIDOR))) best = d;
      }
    };
    for (let r = 1; r <= rings; r++) {
      if ((r - 1) * c >= best) break;
      for (let di = -r; di <= r; di++) {
        probe(di, -r);
        probe(di, r);
      }
      for (let dj = -r + 1; dj <= r - 1; dj++) {
        probe(-r, dj);
        probe(r, dj);
      }
    }
    return Math.min(maxr, Math.max(0, best - c));
  }

  // Builds the clearance field: for each cell, the distance in pt to the
  // nearest obstacle (text, outside or placed; corridors do not count), by
  // two chamfer passes (within about 8% of Euclidean) from cell centres.
  // Placed elements then lower it through disc() and box().
  field(): void {
    const nx = this.nx, ny = this.ny, v = this.v, c = this.c;
    const f: number[] = [];
    for (let k = 0; k < nx * ny; k++) f.push(v[k] === FREE || v[k] === CORRIDOR ? 1e9 : 0);
    const d1 = 1, d2 = Math.sqrt(2);
    // Cells beyond the grid count as obstacles.
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : f[j * nx + i]);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (f[k] > 0) f[k] = Math.min(f[k], at(i - 1, j) + d1, at(i, j - 1) + d1, at(i - 1, j - 1) + d2, at(i + 1, j - 1) + d2);
      }
    }
    for (let j = ny - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        if (f[k] > 0) f[k] = Math.min(f[k], at(i + 1, j) + d1, at(i, j + 1) + d1, at(i + 1, j + 1) + d2, at(i - 1, j + 1) + d2);
      }
    }
    let maxf = 0;
    for (let k = 0; k < nx * ny; k++) {
      // From cell steps to pt, measured to the obstacle cell's near edge.
      f[k] = Math.max(0, (f[k] - 0.5) * c);
      if (f[k] > maxf) maxf = f[k];
    }
    this.f = f;
    this.maxf = maxf;
  }

  // How large a disc centred at (x, y) fits, in pt: -1 off the grid, 0 on
  // an obstacle. Needs field().
  room(x: number, y: number): number {
    if (!this.f) throw new Error("space: room() needs field() first");
    const i = Math.floor(x / this.c), j = Math.floor(y / this.c);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return this.f[j * this.nx + i];
  }

  // Records a placed element as a proxy disc of radius r. The field counts
  // it at k of its radius (k < 1 lets later elements tuck a little under it)
  // and the cells inside that are marked placed.
  disc(x: number, y: number, r: number, k = 1): void {
    const kr = k * r;
    const f = this.f;
    if (f) {
      const c = this.c, reach = kr + this.maxf;
      const i0 = Math.max(0, Math.floor((x - reach) / c)), i1 = Math.min(this.nx - 1, Math.floor((x + reach) / c));
      const j0 = Math.max(0, Math.floor((y - reach) / c)), j1 = Math.min(this.ny - 1, Math.floor((y + reach) / c));
      for (let j = j0; j <= j1; j++) {
        const cy = (j + 0.5) * c - y;
        for (let i = i0; i <= i1; i++) {
          const cx = (i + 0.5) * c - x;
          const at = j * this.nx + i;
          const d = Math.sqrt(cx * cx + cy * cy) - kr;
          if (d < f[at]) f[at] = Math.max(0, d);
        }
      }
    }
    this.mark(x, y, kr, PLACED);
  }

  // Records a placed rectangle: the field falls to the distance from the
  // box and the cells inside are marked placed.
  box(x0: number, y0: number, x1: number, y1: number): void {
    const c = this.c, f = this.f;
    if (f) {
      const reach = this.maxf;
      const i0 = Math.max(0, Math.floor((x0 - reach) / c)), i1 = Math.min(this.nx - 1, Math.floor((x1 + reach) / c));
      const j0 = Math.max(0, Math.floor((y0 - reach) / c)), j1 = Math.min(this.ny - 1, Math.floor((y1 + reach) / c));
      for (let j = j0; j <= j1; j++) {
        const dy = Math.max(y0 - (j + 0.5) * c, (j + 0.5) * c - y1, 0);
        for (let i = i0; i <= i1; i++) {
          const dx = Math.max(x0 - (i + 0.5) * c, (i + 0.5) * c - x1, 0);
          const k = j * this.nx + i;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < f[k]) f[k] = d;
        }
      }
    }
    const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(this.nx - 1, Math.floor(x1 / c));
    const j0 = Math.max(0, Math.floor(y0 / c)), j1 = Math.min(this.ny - 1, Math.floor(y1 / c));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        if (this.v[k] === FREE || this.v[k] === CORRIDOR) this.v[k] = PLACED;
      }
    }
  }

  // Marks a disc as taken by a placed element (PLACED, the default) or a
  // stem's corridor (CORRIDOR). A placed element also lowers the field.
  reserve(x: number, y: number, r: number, val = PLACED): void {
    if (this.f && val === PLACED) this.disc(x, y, r, 1);
    else this.mark(x, y, r, val);
  }

  private mark(x: number, y: number, r: number, val: number): void {
    const c = this.c;
    const i0 = Math.max(0, Math.floor((x - r) / c)), i1 = Math.min(this.nx - 1, Math.floor((x + r) / c));
    const j0 = Math.max(0, Math.floor((y - r) / c)), j1 = Math.min(this.ny - 1, Math.floor((y + r) / c));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * c, cy = (j + 0.5) * c;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) {
          const k = j * this.nx + i;
          if (this.v[k] === FREE) this.v[k] = val;
        }
      }
    }
  }

  // Reserves along a polyline: every other point at radius r, or every
  // point at its own radius r[i].
  reserveLine(pts: readonly Pt[], r: number | readonly number[], val = PLACED): void {
    if (typeof r !== "number") {
      for (let i = 0; i < pts.length; i++) this.reserve(pts[i][0], pts[i][1], r[i], val);
      return;
    }
    for (let i = 0; i < pts.length; i += 2) this.reserve(pts[i][0], pts[i][1], r, val);
  }

  // The centres of free cells, every `step`th cell each way, row by row.
  freeCells(step = 1): Pt[] {
    const out: Pt[] = [];
    for (let j = 0; j < this.ny; j += step) {
      for (let i = 0; i < this.nx; i += step) {
        if (this.v[j * this.nx + i] === FREE) out.push([(i + 0.5) * this.c, (j + 0.5) * this.c]);
      }
    }
    return out;
  }

  // The share of the open region (free or placed) that is placed.
  coverage(): number {
    let free = 0, placed = 0;
    for (const v of this.v) {
      if (v === FREE) free++;
      else if (v === PLACED || v === CORRIDOR) placed++;
    }
    return free + placed === 0 ? 1 : placed / (free + placed);
  }
}
