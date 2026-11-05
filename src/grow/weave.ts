// Where a garden's strands (garden.ts) cross, and which passes over: as
// each stretch of a strand is inked its segments are checked against
// every strand's inked so far. Two strands take turns at the crossings
// between them, as woven threads do, so neither lies wholly on top.
import type { Pt } from "../engine/geom.ts";

// What the weave reads of a strand: its id, points and arc length at each.
export interface Strand {
  readonly id: number;
  readonly pts: readonly Pt[];
  readonly arc: readonly number[];
}

export interface Crossing {
  // Where they cross, page pt; the strand on top and the one under, and
  // the arc along each there; the angle between them (radians, 0 to pi/2); and the tick by
  // which both inks have reached it.
  readonly at: Pt;
  readonly over: Strand;
  readonly s: number;
  readonly under: Strand;
  readonly su: number;
  readonly angle: number;
  readonly t: number;
}

// The grid cell, pt; how near along one strand a crossing of itself may
// lie and not count, pt; how near two crossings of the same pair may lie
// and count once, pt; and how far along a strand from its start nothing
// counts, pt, as strands leave the root, and a sprout its stem, together.
const CELL = 12, SELF = 30, APART = 16, START = 20;

interface Seg {
  readonly strand: Strand;
  readonly i: number;
  // The tick its ink reaches its start and its end.
  readonly t0: number;
  readonly t1: number;
}

export class Weave {
  private readonly cells = new Map<number, Seg[]>();
  // Per pair of strands, the crossings so far and where the last was.
  private readonly pairs = new Map<string, { n: number; last: Pt }>();
  readonly crossings: Crossing[] = [];

  private key(i: number, j: number): number {
    return j * 100003 + i;
  }

  private each(a: Pt, b: Pt, fn: (k: number) => void): void {
    const i0 = Math.floor(Math.min(a[0], b[0]) / CELL), i1 = Math.floor(Math.max(a[0], b[0]) / CELL);
    const j0 = Math.floor(Math.min(a[1], b[1]) / CELL), j1 = Math.floor(Math.max(a[1], b[1]) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(this.key(i, j));
  }

  // Ink strand st's segments i0..i1 - 1, `ink(i)` the tick its ink reaches
  // point i: the crossings they make with what is inked, in order along it.
  ink(st: Strand, i0: number, i1: number, ink: (i: number) => number): Crossing[] {
    const out: Crossing[] = [];
    for (let i = i0; i < i1; i++) {
      const a = st.pts[i], b = st.pts[i + 1];
      const seen = new Set<Seg>();
      let best: { seg: Seg; u: number; v: number } | undefined;
      this.each(a, b, (k) => {
        for (const sg of this.cells.get(k) ?? []) {
          if (seen.has(sg)) continue;
          seen.add(sg);
          if (sg.strand === st && Math.abs(st.arc[i] - st.arc[sg.i]) < SELF) continue;
          if (st.arc[i + 1] - st.arc[0] < START || sg.strand.arc[sg.i + 1] - sg.strand.arc[0] < START) continue;
          const hit = cross(a, b, sg.strand.pts[sg.i], sg.strand.pts[sg.i + 1]);
          if (hit !== undefined && (best === undefined || hit[0] < best.u)) best = { seg: sg, u: hit[0], v: hit[1] };
        }
      });
      if (best !== undefined) {
        const c = this.crossing(st, i, best.seg, best.u, best.v, ink);
        if (c !== undefined) out.push(c);
      }
      const seg: Seg = { strand: st, i, t0: ink(i), t1: ink(i + 1) };
      this.each(a, b, (k) => {
        const l = this.cells.get(k);
        if (l === undefined) this.cells.set(k, [seg]);
        else l.push(seg);
      });
    }
    return out;
  }

  // Segment i of st crossing seg at u along it and v along seg's.
  private crossing(st: Strand, i: number, seg: Seg, u: number, v: number, ink: (i: number) => number): Crossing | undefined {
    const o = seg.strand;
    const a = st.pts[i], b = st.pts[i + 1];
    const at: Pt = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    const lo = Math.min(st.id, o.id), hi = Math.max(st.id, o.id);
    const pk = lo + ":" + hi;
    const pair = this.pairs.get(pk);
    if (pair !== undefined && Math.hypot(pair.last[0] - at[0], pair.last[1] - at[1]) < APART) return undefined;
    const n = pair?.n ?? 0;
    this.pairs.set(pk, { n: n + 1, last: at });
    // The lower id's strand passes over at the pair's first crossing, then
    // under, then over; a strand crossing itself, the later stretch first.
    const mine = st.id === o.id ? n % 2 === 0 : (n % 2 === 0) === (st.id === lo);
    const sOn = (s: Strand, j: number, f: number) => s.arc[j] + (s.arc[j + 1] - s.arc[j]) * f;
    const p0 = o.pts[seg.i], p1 = o.pts[seg.i + 1];
    const d = Math.abs(Math.atan2((b[0] - a[0]) * (p1[1] - p0[1]) - (b[1] - a[1]) * (p1[0] - p0[0]), (b[0] - a[0]) * (p1[0] - p0[0]) + (b[1] - a[1]) * (p1[1] - p0[1])));
    const angle = d > Math.PI / 2 ? Math.PI - d : d;
    const t = Math.max(ink(i) + (ink(i + 1) - ink(i)) * u, seg.t0 + (seg.t1 - seg.t0) * v);
    const c: Crossing = mine
      ? { at, over: st, s: sOn(st, i, u), under: o, su: sOn(o, seg.i, v), angle, t }
      : { at, over: o, s: sOn(o, seg.i, v), under: st, su: sOn(st, i, u), angle, t };
    this.crossings.push(c);
    return c;
  }
}

// Where segments a-b and c-d cross: how far along each, or undefined.
function cross(a: Pt, b: Pt, c: Pt, d: Pt): [number, number] | undefined {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return undefined;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const u = (qx * sy - qy * sx) / den, v = (qx * ry - qy * rx) / den;
  return u >= 0 && u < 1 && v >= 0 && v < 1 ? [u, v] : undefined;
}

// The points of st within `half` of arc s, ends cut to length.
export function around(st: Strand, s: number, half: number): Pt[] {
  const out: Pt[] = [];
  const at = (q: number): Pt => {
    let j = 0;
    while (j < st.arc.length - 2 && st.arc[j + 1] < q) j++;
    const f = Math.max(0, Math.min(1, (q - st.arc[j]) / Math.max(1e-9, st.arc[j + 1] - st.arc[j])));
    const p = st.pts[j], r = st.pts[j + 1];
    return [p[0] + (r[0] - p[0]) * f, p[1] + (r[1] - p[1]) * f];
  };
  const s0 = Math.max(st.arc[0], s - half), s1 = Math.min(st.arc[st.arc.length - 1], s + half);
  out.push(at(s0));
  for (let j = 0; j < st.arc.length; j++) if (st.arc[j] > s0 && st.arc[j] < s1) out.push(st.pts[j]);
  out.push(at(s1));
  return out;
}
