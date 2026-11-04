// The food a garden's tips grow toward (garden.ts): points scattered
// through the region, each taken when a tip passes near it (space
// colonization, Runions et al. 2005). A tip is drawn to the points ahead
// of it; with none near, it seeks the nearest by a path through the open
// cells, as a slime mould's front finds its way through a maze to food.
// The region is cut into bands down from its top, each scattered with
// points from a stream of its own when the plant comes near it.
import type { Pt } from "../engine/geom.ts";
import type { Rng } from "../engine/rng.ts";

// A band's height, pt; how far apart its points lie, pt; and how far a tip
// feels their pull, pt.
export const BAND = 240;
const SPACING = 34, PULL = 90;

export interface Band {
  // Points, x and y in turn, and which are still there.
  readonly pts: number[];
  readonly alive: number[];
  // The tick it was scattered at, and whether it has been gilt.
  readonly at: number;
  settled: boolean;
}

export class Food {
  readonly bands: (Band | undefined)[] = [];
  private readonly nx: number;
  private readonly ny: number;
  // Points per cell, and a stamp per cell for searches.
  private readonly count: Int32Array;
  private readonly seen: Int32Array;
  private readonly prev: Int32Array;
  private stamp = 0;

  readonly width: number;
  readonly height: number;
  readonly cell: number;
  // A band's own stream, and where a point may lie.
  private readonly rngOf: (k: number) => Rng;
  private readonly free: (x: number, y: number) => boolean;

  constructor(width: number, height: number, cell: number, rngOf: (k: number) => Rng, free: (x: number, y: number) => boolean) {
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.rngOf = rngOf;
    this.free = free;
    this.nx = Math.ceil(width / cell);
    this.ny = Math.ceil(height / cell);
    this.count = new Int32Array(this.nx * this.ny);
    this.seen = new Int32Array(this.nx * this.ny);
    this.prev = new Int32Array(this.nx * this.ny);
  }

  // Band k of the region, down from its top, at page y.
  bandOf(y: number): number {
    return Math.floor((this.height - y) / BAND);
  }

  private cellOf(x: number, y: number): number {
    const i = Math.floor(x / this.cell), j = Math.floor(y / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i;
  }

  // Scatter every band down to k not yet scattered: darts thrown from the
  // band's own stream, kept where they fall free and SPACING clear of the
  // others.
  seedTo(k: number, tick: number): void {
    const last = Math.min(k, Math.ceil(this.height / BAND) - 1);
    for (let b = 0; b <= last; b++) {
      if (this.bands[b] !== undefined) continue;
      const rng = this.rngOf(b);
      const y1 = this.height - b * BAND, y0 = y1 - BAND;
      const pts: number[] = [], alive: number[] = [];
      const near = (x: number, y: number) => {
        for (const o of [this.bands[b - 1], { pts }]) {
          if (o === undefined) continue;
          for (let i = 0; i < o.pts.length; i += 2) if ((o.pts[i] - x) ** 2 + (o.pts[i + 1] - y) ** 2 < SPACING * SPACING) return true;
        }
        return false;
      };
      const tries = Math.ceil(((this.width * BAND) / (SPACING * SPACING)) * 2);
      for (let i = 0; i < tries; i++) {
        const x = rng.range(0, this.width), y = rng.range(y0, y1);
        if (!this.free(x, y) || near(x, y)) continue;
        pts.push(x, y);
        alive.push(1);
        const c = this.cellOf(x, y);
        if (c >= 0) this.count[c]++;
      }
      this.bands[b] = { pts, alive, at: tick, settled: false };
    }
  }

  // Points still there.
  left(): number {
    let n = 0;
    for (const b of this.bands) if (b !== undefined) for (const a of b.alive) n += a;
    return n;
  }

  // Visit the points within r of (x, y) still there: fn(band, index, dx,
  // dy, d).
  private near(x: number, y: number, r: number, fn: (b: Band, i: number, dx: number, dy: number, d: number) => void): void {
    for (let k = Math.max(0, this.bandOf(y + r)); k <= this.bandOf(y - r); k++) {
      const b = this.bands[k];
      if (b === undefined) continue;
      for (let i = 0; i < b.alive.length; i++) {
        if (b.alive[i] === 0) continue;
        const dx = b.pts[2 * i] - x, dy = b.pts[2 * i + 1] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r) fn(b, i, dx, dy, d);
      }
    }
  }

  // Take the points within r of (x, y).
  take(x: number, y: number, r: number): void {
    this.near(x, y, r, (b, i) => {
      b.alive[i] = 0;
      const c = this.cellOf(b.pts[2 * i], b.pts[2 * i + 1]);
      if (c >= 0) this.count[c]--;
    });
  }

  // The pull on a tip at (x, y) heading `a` of the points ahead of it, as
  // a unit vector, and how many there are; those within `kill` are taken.
  pull(x: number, y: number, a: number, kill: number): [number, number, number] {
    if (kill > 0) this.take(x, y, kill);
    let vx = 0, vy = 0, n = 0;
    const ca = Math.cos(a), sa = Math.sin(a);
    this.near(x, y, PULL, (_b, _i, dx, dy, d) => {
      if (d === 0 || (dx * ca + dy * sa) / d < 0.2) return;
      vx += dx / d / (1 + d / 40);
      vy += dy / d / (1 + d / 40);
      n++;
    });
    const m = Math.sqrt(vx * vx + vy * vy);
    return m > 0 ? [vx / m, vy / m, n] : [0, 0, 0];
  }

  // A breadth-first search over the cells `pass` allows, from `starts`
  // until `goal` holds of a cell, visiting at most `limit` cells; the cell
  // found, or -1. prev holds the way back.
  private search(starts: readonly number[], pass: (c: number) => boolean, goal: (c: number) => boolean, limit: number): number {
    this.stamp++;
    const nx = this.nx, ny = this.ny, seen = this.seen, prev = this.prev;
    const queue: number[] = [];
    for (const c of starts) {
      if (c < 0 || seen[c] === this.stamp) continue;
      seen[c] = this.stamp;
      prev[c] = -1;
      queue.push(c);
    }
    for (let h = 0; h < queue.length && h < limit; h++) {
      const c = queue[h];
      if (goal(c)) return c;
      const i = c % nx, j = (c - i) / nx;
      for (const [di, dj] of STEPS) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const n = b * nx + a;
        if (seen[n] === this.stamp || !pass(n)) continue;
        seen[n] = this.stamp;
        prev[n] = c;
        queue.push(n);
      }
    }
    return -1;
  }

  private centre(c: number): Pt {
    const i = c % this.nx;
    return [(i + 0.5) * this.cell, ((c - i) / this.nx + 0.5) * this.cell];
  }

  // Where a tip at (x, y) heads for the nearest point by the open cells
  // (`pass` at a cell centre): a spot `ahead` pt along the way, or
  // undefined if none lies within `limit` cells.
  seek(x: number, y: number, pass: (x: number, y: number) => boolean, ahead: number, limit: number): Pt | undefined {
    const from = this.cellOf(x, y);
    const found = this.search([from], (c) => pass(...this.centre(c)), (c) => this.count[c] > 0, limit);
    if (found < 0) return undefined;
    const path: number[] = [];
    for (let c = found; c >= 0; c = this.prev[c]) path.push(c);
    path.reverse();
    return this.centre(path[Math.min(path.length - 1, Math.ceil(ahead / this.cell))]);
  }

  // The stem cell nearest a point still there below page y `below` by the
  // open cells, the heading from it toward that point, and the point:
  // where a plant that has stopped sprouts again.
  sprout(pass: (x: number, y: number) => boolean, stem: (x: number, y: number) => boolean, limit: number, below = Infinity): { at: Pt; a: number; goal: Pt } | undefined {
    const starts: number[] = [];
    for (let c = 0; c < this.count.length; c++) if (this.count[c] > 0 && this.centre(c)[1] < below) starts.push(c);
    if (starts.length === 0) return undefined;
    const found = this.search(starts, (c) => {
      const q = this.centre(c);
      return pass(q[0], q[1]) || stem(q[0], q[1]);
    }, (c) => stem(...this.centre(c)), limit);
    if (found < 0) return undefined;
    // prev leads from the stem back toward the point it was reached from.
    let goal = found;
    while (this.prev[goal] >= 0) goal = this.prev[goal];
    const at = this.centre(found);
    let to = found;
    for (let k = 0; k < 8 && this.prev[to] >= 0; k++) to = this.prev[to];
    const t = this.centre(to);
    return { at, a: Math.atan2(t[1] - at[1], t[0] - at[0]), goal: this.centre(goal) };
  }
}

const STEPS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
