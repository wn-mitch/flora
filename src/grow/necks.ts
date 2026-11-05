// Where each leaf of a growing garden (garden.ts) joins its stem, kept in
// sight: a leaf whose joint something is painted over looks to float free
// of its stem. Pieces are painted by layer, then as they are laid down
// (pieces.ts), so a later leaf lies over an earlier one and sprays lie
// under leaves; what may hide a leaf's joint is a later leaf, or a bloom.
// Grids of the garden's cells keep each leaf's neck (its joint at the stem
// and the first of its blade), what covers each cell, and what blooms
// cover, by owner (a node's leaves share one, so a pair from one node may
// lie across each other's base).
import type { Pt } from "../engine/geom.ts";

// How much of a leaf's length from its joint is its neck; the least neck,
// pt; and the reach of the joint about the stem point, pt.
const NECK = 0.18, LEAST = 6, JOINT = 4;

// A piece's id and the ticks it starts and finishes at.
export interface Timed {
  readonly id: number;
  readonly start: number;
  readonly end: number;
}

export class Necks {
  private readonly nx: number;
  private readonly ny: number;
  // Per cell, the owner of the neck there; two of the owners covering it
  // (enough to tell whether another than a given one does); and the bloom
  // over it. 0 for none.
  private readonly neck: Int32Array;
  private readonly coverA: Int32Array;
  private readonly coverB: Int32Array;
  private readonly bloom: Int32Array;
  // Each leaf owner's neck cells; the leaves lying over its neck, and
  // those whose necks it lies over; and, once made, its piece's id and
  // ticks.
  private readonly cells = new Map<number, number[]>();
  private readonly under = new Map<number, number[]>();
  private readonly over = new Map<number, number[]>();
  private readonly made = new Map<number, Timed>();
  // The cell, pt.
  private readonly c: number;

  constructor(width: number, height: number, c = 3) {
    this.c = c;
    this.nx = Math.ceil(width / c);
    this.ny = Math.ceil(height / c);
    const n = this.nx * this.ny;
    this.neck = new Int32Array(n);
    this.coverA = new Int32Array(n);
    this.coverB = new Int32Array(n);
    this.bloom = new Int32Array(n);
  }

  // Whether a leaf of `owner` from stem point p with page outline `outline`
  // may be put: it lies over no other leaf's neck, and no bloom lies over
  // its own.
  leafClear(owner: number, p: Pt, outline: readonly Pt[]): boolean {
    let ok = true;
    this.leafCells(p, outline, (k, neck) => {
      if ((this.neck[k] !== 0 && this.neck[k] !== owner) || (neck && this.bloom[k] !== 0)) ok = false;
      return ok;
    });
    return ok;
  }

  // Record that leaf: its neck, what it covers, and which leaves lie over
  // its neck.
  markLeaf(owner: number, p: Pt, outline: readonly Pt[]): void {
    let mine = this.cells.get(owner);
    if (mine === undefined) this.cells.set(owner, (mine = []));
    const list = mine;
    const under = this.under.get(owner) ?? [];
    this.under.set(owner, under);
    this.leafCells(p, outline, (k, neck) => {
      if (neck) {
        for (const x of [this.coverA[k], this.coverB[k]]) {
          if (x === 0 || x === owner || !this.cells.has(x) || under.includes(x)) continue;
          under.push(x);
          const o = this.over.get(x) ?? [];
          o.push(owner);
          this.over.set(x, o);
        }
      }
      if (neck && this.neck[k] === 0) {
        this.neck[k] = owner;
        list.push(k);
      }
      this.covered(k, owner);
      return true;
    });
  }

  // Whether anything but leaf `owner` itself covers some of its neck: as
  // it would be, were the leaf put behind the stems.
  hidden(owner: number): boolean {
    for (const k of this.cells.get(owner) ?? []) {
      const a = this.coverA[k], b = this.coverB[k];
      if ((a !== 0 && a !== owner) || (b !== 0 && b !== owner)) return true;
    }
    return false;
  }

  // Whether a bloom of radius r at (x, y), on a stalk from s if given,
  // lies over no leaf's neck.
  bare(x: number, y: number, r: number, s?: Pt): boolean {
    let ok = true;
    const no = (k: number) => {
      if (this.neck[k] !== 0) ok = false;
      return ok;
    };
    this.disc(x, y, r, no);
    if (s !== undefined && ok) this.line(s, [x, y], 1.5, no);
    return ok;
  }

  // Record that `owner` covers a disc of radius r at (x, y), and a stalk
  // from s to it if given; a bloom with `bloom`.
  markDisc(owner: number, x: number, y: number, r: number, s: Pt | undefined, bloom: boolean): void {
    const mark = (k: number) => {
      this.covered(k, owner);
      if (bloom && this.bloom[k] === 0) this.bloom[k] = owner;
      return true;
    };
    this.disc(x, y, r, mark);
    if (s !== undefined) this.line(s, [x, y], 1.5, mark);
  }

  // Time leaf `owner`, made as piece `p`, so that it finishes (and so is
  // painted, pieces.ts) after each leaf lying over its neck and before each
  // whose neck it lies over: p's ticks, later if need be; or undefined if
  // a leaf whose neck it lies over has started and would finish first, or
  // cannot be put later without passing another. `later` puts the piece of
  // id `id`, not yet started, d ticks later.
  order(owner: number, p: Timed, tick: number, later: (id: number, d: number) => void): Timed | undefined {
    let q = p;
    for (const x of this.under.get(owner) ?? []) {
      const px = this.made.get(x);
      if (px !== undefined && px.end >= q.end) q = { id: q.id, start: q.start + px.end + 1 - q.end, end: px.end + 1 };
    }
    for (const c of this.over.get(owner) ?? []) {
      const pc = this.made.get(c);
      if (pc === undefined || pc.end > q.end) continue;
      if (pc.start <= tick || (this.over.get(c) ?? []).some((d) => this.made.has(d))) return undefined;
      const d = q.end + 1 - pc.end;
      later(pc.id, d);
      this.made.set(c, { id: pc.id, start: pc.start + d, end: pc.end + d });
    }
    this.made.set(owner, q);
    return q;
  }

  private covered(k: number, owner: number): void {
    if (this.coverA[k] === 0) this.coverA[k] = owner;
    else if (this.coverA[k] !== owner && this.coverB[k] === 0) this.coverB[k] = owner;
  }

  // Each cell inside `outline`, or within the joint about p, with whether
  // it is in the neck; until `fn` returns false.
  private leafCells(p: Pt, outline: readonly Pt[], fn: (k: number, neck: boolean) => boolean): void {
    let x0 = p[0] - JOINT, x1 = p[0] + JOINT, y0 = p[1] - JOINT, y1 = p[1] + JOINT, far = 0;
    for (const q of outline) {
      x0 = Math.min(x0, q[0]);
      x1 = Math.max(x1, q[0]);
      y0 = Math.min(y0, q[1]);
      y1 = Math.max(y1, q[1]);
      far = Math.max(far, Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
    const reach = Math.max(LEAST, far * NECK);
    const c = this.c, xs: number[] = [];
    for (let j = Math.max(0, Math.floor(y0 / c)); j <= Math.min(this.ny - 1, Math.floor(y1 / c)); j++) {
      const y = (j + 0.5) * c;
      // Where the outline crosses this row of cell centres: inside between
      // each pair, by the even-odd rule.
      xs.length = 0;
      for (let a = 0, b = outline.length - 1; a < outline.length; b = a++) {
        const [xa, ya] = outline[a], [xb, yb] = outline[b];
        if (ya > y !== yb > y) xs.push(xa + ((xb - xa) * (y - ya)) / (yb - ya));
      }
      xs.sort((u, v) => u - v);
      for (let i = Math.max(0, Math.floor(x0 / c)); i <= Math.min(this.nx - 1, Math.floor(x1 / c)); i++) {
        const x = (i + 0.5) * c, d = Math.hypot(x - p[0], y - p[1]);
        let inside = d <= JOINT;
        if (!inside) {
          let n = 0;
          while (n < xs.length && xs[n] <= x) n++;
          inside = n % 2 === 1;
        }
        if (inside && !fn(j * this.nx + i, d <= reach)) return;
      }
    }
  }

  private disc(x: number, y: number, r: number, fn: (k: number) => boolean): void {
    const c = this.c;
    for (let j = Math.max(0, Math.floor((y - r) / c)); j <= Math.min(this.ny - 1, Math.floor((y + r) / c)); j++) {
      for (let i = Math.max(0, Math.floor((x - r) / c)); i <= Math.min(this.nx - 1, Math.floor((x + r) / c)); i++) {
        if (((i + 0.5) * c - x) ** 2 + ((j + 0.5) * c - y) ** 2 <= r * r && !fn(j * this.nx + i)) return;
      }
    }
  }

  private line(a: Pt, b: Pt, r: number, fn: (k: number) => boolean): void {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / this.c));
    for (let t = 0; t <= n; t++) {
      let ok = true;
      this.disc(a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n, r, (k) => (ok = fn(k)));
      if (!ok) return;
    }
  }
}
