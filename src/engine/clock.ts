// The growth clock for "watch it grow" frames (spec.grow, 0-1).
//
// Every point of the page gets a birth time: its distance from the plant's
// root, measured along the stems and then across the page to the nearest
// stem (a Dijkstra field over the occupancy grid). At frame time T the
// growth front has reached u = T * span; stems are revealed up to it,
// leaves unfurl and blooms open as it passes them, and the ornaments and
// gilt come last.
//
// Planning never changes with T. Painting does only through clips, scaling
// about an anchor and leaving whole elements out, and an element left out
// is still painted and then withdrawn (Painter.withdraw), so every random
// stream is consumed exactly as in the finished page and nothing changes
// its look from frame to frame. Compose uses the clock only for T < 1, so
// the last frame is the finished page itself.
import { mod } from "#platform";
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import type { StemLike } from "./grow.ts";
import * as L from "./leaf.ts";
import type { Leaflet } from "./leaf.ts";
import type { Sparkle } from "./ornament.ts";
import type { Clock, Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";
import type { Space } from "./space.ts";

const INF = Infinity;

// What paints a list of leaflets (leaf.ts leaflets by default).
export type LeafletPainter = (this: void, pt: Painter, rng: Rng, items: readonly Leaflet[]) => void;

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

// Ease-out: fast start, gentle finish.
function ease(t: number): number {
  const s = 1 - t;
  return 1 - s * s * s;
}

// Paint fn() scaled by k about `anchor`, inside whatever frame is set.
function scaled(pt: Painter, anchor: Pt, k: number, fn: () => void): void {
  const base = pt.currentFrame;
  const ax = anchor[0], ay = anchor[1];
  pt.frame((x, y) => {
    const sx = ax + (x - ax) * k, sy = ay + (y - ay) * k;
    return base === undefined ? [sx, sy] : base(sx, sy);
  });
  fn();
  pt.frame(base);
}

export class GrowthClock implements Clock {
  readonly T: number;
  // The largest birth time on a stem: where the last stem ends.
  readonly reach: number;
  // The growth over the whole clip (pt): the stems take its first 75%.
  readonly span: number;
  // How far the front has reached at T (pt).
  readonly u: number;
  private readonly g: Space;
  private readonly stems: readonly StemLike[];
  // Per stem (in the order given): when the front reaches its first point,
  // and the arc length at each of its points.
  private readonly offset: number[] = [];
  private readonly arc: number[][] = [];
  // Birth time per grid cell, INF where no stem reaches.
  private readonly f: number[] = [];

  // A clock for frame time T over grid g (space.ts) and `stems`; the first
  // is rooted at the plant's root. Each later stem starts when the growth
  // front reaches its first point along the stems before it.
  constructor(g: Space, stems: readonly StemLike[], T: number) {
    this.g = g;
    this.stems = stems;
    this.T = T;
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
    // The front sweeps the stems in the first 75% of the clip; blooms open
    // and the gilt arrives in the rest.
    this.span = reach / 0.75;
    this.u = T * this.span;
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

  // Progress 0-1 of something born at `b` that takes `dur` (share of the
  // span) to complete.
  progress(b: number, dur: number): number {
    return Math.max(0, Math.min(1, (this.u - b) / (dur * this.span)));
  }

  // Has the front reached (x, y)?
  born(x: number, y: number): boolean {
    return this.birth(x, y) <= this.u;
  }

  // Paint element fn(pt) anchored at `at` (undefined places it last),
  // growing over `dur` of the span from its birth plus `delay` (pt): in
  // full once grown, withdrawn before its birth, and in between scaled up
  // about its anchor.
  draw(pt: Painter, fn: (this: void, pt: Painter) => void, at: Pt | undefined, dur = 0.08, delay = 0): void {
    const b = at !== undefined ? this.birth(at[0], at[1]) + delay : this.reach;
    const k = this.progress(b, dur);
    if (k >= 1) fn(pt);
    else if (k <= 0) pt.withdraw(() => fn(pt));
    else scaled(pt, at ?? [0, 0], 0.15 + 0.85 * ease(k), () => fn(pt));
  }

  // Paint stem s with paint(pt) (which paints it whole), revealed up to the
  // front: clipped to a band `wmax` wide round the part already grown. A
  // stem the clock was not built with paints whole.
  stem(pt: Painter, s: StemLike, wmax: number, paint: (this: void, pt: Painter) => void): void {
    const si = this.stems.indexOf(s);
    if (si < 0) {
      paint(pt);
      return;
    }
    const a = this.arc[si];
    const len = a[a.length - 1];
    const shown = this.u - this.offset[si];
    if (shown >= len) {
      paint(pt);
    } else if (shown <= 0) {
      pt.withdraw(() => paint(pt));
    } else {
      const prefix: Pt[] = [];
      for (let i = 0; i < s.pts.length; i++) {
        if (a[i] > shown) break;
        prefix.push(s.pts[i]);
      }
      if (prefix.length < 2) {
        pt.withdraw(() => paint(pt));
        return;
      }
      const half = wmax / 2 + 2;
      pt.clipBegin(G.smooth(G.ribbon(prefix, () => half), true));
      paint(pt);
      pt.clipEnd();
    }
  }

  // Leaflets [x, y, ang, len], each unfurling from its base, painted one by
  // one with the shared stream as `paint` would paint them together.
  leaflets(pt: Painter, rng: Rng, items: readonly Leaflet[], paint: LeafletPainter = L.leaflets): void {
    for (const it of items) this.draw(pt, (p) => paint(p, rng, [it]), [it[0], it[1]], 0.05);
  }

  // The sparkle items shown so far: they arrive in turn once the stems have
  // finished, over a fifth of the span.
  sparkles(items: readonly Sparkle[]): Sparkle[] {
    const out: Sparkle[] = [];
    const k = this.progress(this.reach, 0.2);
    for (let i = 0; i < items.length; i++) if (i + 1 <= items.length * k) out.push(items[i]);
    return out;
  }
}
