// The growth clock: when the growth front reaches each point of a plant.
//
// Every point of the page gets a birth time: its distance from the plant's
// root, measured along the stems and then across the page to the nearest
// stem (a Dijkstra field over the occupancy grid). Each later stem starts
// when the front reaches its first point along the stems before it. Birth
// times are pt of growth, and the front moves a pt of stem per pt; compose
// lays the painting down by them (Painter.lay, timeline.ts).
import { mod } from "#platform";
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import type { StemLike } from "./grow.ts";
import type { Space } from "./space.ts";

const INF = Infinity;

// A binary min-heap of (key, cell) pairs in two parallel arrays. Popped
// slots stay in the arrays past n and are overwritten by later pushes, so
// the arrays never hold holes.
class Heap {
  n = 0;
  private keys: number[] = [];
  private cells: number[] = [];

  private set(i: number, k: number, v: number): void {
    if (i < this.keys.length) {
      this.keys[i] = k;
      this.cells[i] = v;
    } else {
      this.keys.push(k);
      this.cells.push(v);
    }
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i], v = this.cells[i];
    this.keys[i] = this.keys[j];
    this.cells[i] = this.cells[j];
    this.keys[j] = k;
    this.cells[j] = v;
  }

  push(k: number, v: number): void {
    let i = this.n;
    this.set(i, k, v);
    this.n++;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  // The smallest key and its cell; the heap must not be empty.
  pop(): [number, number] {
    const top: [number, number] = [this.keys[0], this.cells[0]];
    this.n--;
    this.keys[0] = this.keys[this.n];
    this.cells[0] = this.cells[this.n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let s = i;
      if (l < this.n && this.keys[l] < this.keys[s]) s = l;
      if (r < this.n && this.keys[r] < this.keys[s]) s = r;
      if (s === i) break;
      this.swap(s, i);
      i = s;
    }
    return top;
  }
}

// Arc length at each point of `pts`.
function arcs(pts: readonly Pt[]): number[] {
  const out = [0];
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += G.dist(pts[i - 1], pts[i]);
    out.push(d);
  }
  return out;
}

export class GrowthClock {
  // The largest birth time on a stem: where the last stem ends.
  readonly reach: number;
  private readonly g: Space;
  private readonly stems: readonly StemLike[];
  // Per stem (in the order given): when the front reaches its first point,
  // and the arc length at each of its points.
  private readonly offset: number[] = [];
  private readonly arc: number[][] = [];
  // Birth time per grid cell, INF where no stem reaches.
  private readonly f: number[] = [];

  // The clock over grid g (space.ts) and `stems`; the first is rooted at
  // the plant's root.
  constructor(g: Space, stems: readonly StemLike[]) {
    this.g = g;
    this.stems = stems;
    const nx = g.nx, ny = g.ny, c = g.c;
    let reach = 0;
    for (let i = 0; i < stems.length; i++) {
      const s = stems[i];
      const a = arcs(s.pts);
      let off = 0;
      if (i > 0) {
        off = INF;
        const p0 = s.pts[0];
        for (let j = 0; j < i; j++) {
          const sj = stems[j].pts, aj = this.arc[j];
          for (let k = 0; k < sj.length; k += 2) {
            const d = this.offset[j] + aj[k] + G.dist(p0, sj[k]);
            if (d < off) off = d;
          }
        }
      }
      this.offset.push(off);
      this.arc.push(a);
      reach = Math.max(reach, off + a[a.length - 1]);
    }
    // The field: stem points are sources; distance spreads over the grid.
    const f = this.f;
    for (let k = 0; k < nx * ny; k++) f.push(INF);
    const h = new Heap();
    const seed = (x: number, y: number, d: number) => {
      const i = Math.floor(x / c), j = Math.floor(y / c);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return;
      const k = j * nx + i;
      if (d < f[k]) {
        f[k] = d;
        h.push(d, k);
      }
    };
    for (let si = 0; si < stems.length; si++) {
      const off = this.offset[si], a = this.arc[si], pts = stems[si].pts;
      for (let k = 0; k < pts.length; k++) seed(pts[k][0], pts[k][1], off + a[k]);
    }
    const diag = c * Math.sqrt(2);
    const steps = [[1, 0, c], [-1, 0, c], [0, 1, c], [0, -1, c], [1, 1, diag], [1, -1, diag], [-1, 1, diag], [-1, -1, diag]];
    while (h.n > 0) {
      const [d, k] = h.pop();
      if (d <= f[k]) {
        const i = mod(k, nx), j = Math.floor(k / nx);
        for (const st of steps) {
          const ii = i + st[0], jj = j + st[1];
          if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) {
            const kk = jj * nx + ii;
            const nd = d + st[2];
            if (nd < f[kk]) {
              f[kk] = nd;
              h.push(nd, kk);
            }
          }
        }
      }
    }
    this.reach = reach;
  }

  // Birth time (in pt of growth) at (x, y), clamped to the grid; reach
  // where no stem's field arrives.
  birth(x: number, y: number): number {
    const c = this.g.c, nx = this.g.nx;
    const i = Math.max(0, Math.min(nx - 1, Math.floor(x / c)));
    const j = Math.max(0, Math.min(this.g.ny - 1, Math.floor(y / c)));
    const d = this.f[j * nx + i];
    return d === INF ? this.reach : d;
  }

  // When the front reaches the first point of stem s, or undefined for a
  // stem the clock was not built with.
  stemStart(s: StemLike): number | undefined {
    const i = this.stems.indexOf(s);
    return i < 0 ? undefined : this.offset[i];
  }
}
