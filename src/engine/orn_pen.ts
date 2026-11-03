// The pen behind the penwork ornaments. Paths are written as the hand
// moves: a run of segments, each turning by a set amount with its
// curvature held, tightening or relaxing (clothoid pieces), so loops close
// smoothly and curls wind in as a flourisher's do. Strokes then take their
// width from the pen's travel: a pointed pen opens into a shade only when
// it is pulled toward the writer, so downstrokes swell and upstrokes and
// crossings stay hairlines.
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import type { Box } from "./orn_registry.ts";

const PI = Math.PI;

export type Shape = "c" | "in" | "out" | "bell";

// A segment of a pen path: its length in units, its turn in full turns
// (positive anticlockwise) and its curvature profile (default "c").
export type Seg = readonly [number, number, Shape?];

interface Profile {
  readonly f: (this: void, t: number) => number;
  readonly mean: number;
}

// Curvature profiles over a segment's length, t in 0-1, each with its mean
// so the segment turns by its full `turn`: c even, `in` tightening (a curl
// winding in), `out` relaxing, `bell` swelling and relaxing.
const SHAPES: Readonly<Record<Shape, Profile>> = {
  c: { f: () => 1, mean: 1 },
  in: { f: (t) => t * t, mean: 1 / 3 },
  out: { f: (t) => (1 - t) ** 2, mean: 1 / 3 },
  bell: { f: (t) => Math.sin(PI * t), mean: 2 / PI },
};

// Points of a path from p heading `a`, through `segs`. Returns the points
// and the final heading.
export function path(p: Pt, a: number, segs: readonly Seg[]): [Pt[], number] {
  const pts: Pt[] = [[p[0], p[1]]];
  let q = p, heading = a;
  for (const s of segs) {
    const shape = SHAPES[s[2] ?? "c"];
    const kmax = (2 * PI * s[1]) / (s[0] * shape.mean);
    const [seg, end] = G.flow(q, heading, s[0], (t) => kmax * shape.f(t),
      Math.max(12, Math.ceil(Math.abs(s[1]) * 72), Math.ceil(s[0] * 40)));
    heading = end;
    for (let i = 1; i < seg.length; i++) pts.push(seg[i]);
    q = seg[seg.length - 1];
  }
  return [pts, heading];
}

// A penman's oval loop: from p heading `a`, the pen circles an oval rx by
// ry (along and across the heading) while drifting `drift` forward, so it
// leaves along the heading it came in on, `drift` further on, having
// crossed its own entry. `side` 1 loops to the left of travel, -1 to the
// right.
export function loop(p: Pt, a: number, rx: number, ry: number, drift: number, side: number): Pt[] {
  const pts: Pt[] = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const th = -PI / 2 + (2 * PI * i) / n;
    const x = rx * Math.cos(th) + (drift * i) / n;
    const y = side * ry * (Math.sin(th) + 1);
    pts.push([p[0] + x * Math.cos(a) - y * Math.sin(a), p[1] + x * Math.sin(a) + y * Math.cos(a)]);
  }
  return pts;
}

// A pen curl off a stem: from p heading `a`, sweeping `dir` (1
// anticlockwise) and winding in, `s` long. Points.
export function sprig(p: Pt, a: number, s: number, dir: number, turns = 1.05): Pt[] {
  return path(p, a, [[s * 0.35, dir * 0.06, "c"], [s * 0.65, dir * turns, "in"]])[0];
}

// Points of `pts` moved `d` along their left normal: an echo line, as a
// flourisher traces a second hairline beside the first.
export function echo(pts: readonly Pt[], d: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = G.angle(pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]);
    out.push(G.polar(pts[i], a + PI / 2, d));
  }
  return out;
}

// Points mirrored about the vertical line x = cx (d = -1), or as they are.
export function mirror(pts: Pt[], cx: number, d: number): Pt[] {
  if (d === 1) return pts;
  return pts.map((p): Pt => [2 * cx - p[0], p[1]]);
}

// Points turned half a turn about (cx, cy).
export function rotate(pts: readonly Pt[], cx: number, cy: number): Pt[] {
  return pts.map((p): Pt => [2 * cx - p[0], 2 * cy - p[1]]);
}

// Box [x0, y0, x1, y1] round a list of point lists.
export function extent(lists: readonly (readonly Pt[])[]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pts of lists) {
    for (const p of pts) {
      b[0] = Math.min(b[0], p[0]);
      b[1] = Math.min(b[1], p[1]);
      b[2] = Math.max(b[2], p[0]);
      b[3] = Math.max(b[3], p[1]);
    }
  }
  return b;
}

// A map that scales point lists drawn in their own units by one factor so
// that `ext` (their extent) fits box b less `pad` all round, centred.
// Returns the map and the scale.
export function fit(ext: Box, b: Box, pad = 0): [(this: void, pts: readonly Pt[]) => Pt[], number] {
  const w = ext[2] - ext[0], h = ext[3] - ext[1];
  const s = Math.min((b[2] - b[0] - 2 * pad) / Math.max(w, 1e-6), (b[3] - b[1] - 2 * pad) / Math.max(h, 1e-6));
  const ox = (b[0] + b[2]) / 2 - (s * (ext[0] + ext[2])) / 2;
  const oy = (b[1] + b[3]) / 2 - (s * (ext[1] + ext[3])) / 2;
  return [(pts) => pts.map((p): Pt => [ox + s * p[0], oy + s * p[1]]), s];
}

// Moving average of list `v` over `r` neighbours either side.
function smooth(v: readonly number[], r: number): number[] {
  const n = v.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
      sum += v[j];
      c++;
    }
    out.push(sum / c);
  }
  return out;
}

export interface PointedOptions {
  readonly hair?: number;  // the hairline (default 0.18)
  readonly shade?: number; // the fullest shade (default 1.2)
  // The pen's pull direction, radians (default straight down; a slanted
  // hand pulls along its slant).
  readonly down?: number;
  // Share of the length over which each end thins to a hairline (default
  // 0.06; [start, finish] for each end).
  readonly taper?: number | readonly [number, number];
  readonly step?: number;  // resampling step, pt (default 0.5)
}

// The outline of a pointed-pen stroke along `pts` (in travel order), as a
// closed point list. Widths are half-widths in pt.
export function pointed(pts: readonly Pt[], o: PointedOptions = {}): Pt[] {
  const hair = o.hair ?? 0.18, shade = o.shade ?? 1.2;
  const n = Math.max(8, Math.ceil(G.length(pts) / (o.step ?? 0.5)));
  const q = G.resample(pts, n);
  const down = o.down ?? -PI / 2;
  const dx = Math.cos(down), dy = Math.sin(down);
  let s: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = q[Math.max(0, i - 1)], b = q[Math.min(n - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.sqrt(tx * tx + ty * ty);
    const pull = l > 0 ? (tx * dx + ty * dy) / l : 0;
    s.push(Math.max(0, pull) ** 1.6);
  }
  // Pressure builds and eases over a few points, not instantly.
  s = smooth(s, Math.max(2, Math.floor(n * 0.025)));
  const tp = o.taper ?? 0.06;
  const t0 = typeof tp === "number" ? tp : tp[0];
  const t1 = typeof tp === "number" ? tp : tp[1];
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const env = G.smoothstep(0, Math.max(t0, 1e-6), t) * G.smoothstep(0, Math.max(t1, 1e-6), 1 - t);
    w.push(hair * (0.55 + 0.45 * env) + (shade - hair) * s[i] * env);
  }
  return G.ribbon(q, (t) => w[Math.floor(t * (n - 1) + 0.5)]);
}

export interface BroadOptions {
  readonly hair?: number;  // the hairline (default 0.15)
  readonly nib?: number;   // the full nib (default 1)
  readonly angle?: number; // the nib's edge, radians (default 30 degrees)
  readonly step?: number;  // resampling step, pt (default 0.5)
}

// The outline of a broad-nib stroke: width follows the angle between the
// travel and the nib's edge, from `hair` to `nib` (half-widths, pt).
export function broad(pts: readonly Pt[], o: BroadOptions = {}): Pt[] {
  const hair = o.hair ?? 0.15, nib = o.nib ?? 1, ang = o.angle ?? PI / 6;
  const n = Math.max(8, Math.ceil(G.length(pts) / (o.step ?? 0.5)));
  const q = G.resample(pts, n);
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = q[Math.max(0, i - 1)], b = q[Math.min(n - 1, i + 1)];
    const t = i / (n - 1);
    const env = G.smoothstep(0, 0.05, t) * G.smoothstep(0, 0.05, 1 - t);
    w.push(hair + (nib - hair) * Math.abs(Math.sin(G.angle(a, b) - ang)) * env);
  }
  return G.ribbon(q, (t) => w[Math.floor(t * (n - 1) + 0.5)]);
}

// A hairline (monoline) stroke outline along `pts`, `w` half-wide,
// thinning to `finish` of that at its end.
export function hairline(pts: readonly Pt[], w: number, finish = 1): Pt[] {
  const n = Math.max(6, Math.ceil(G.length(pts) / 0.6));
  const q = G.resample(pts, n);
  return G.ribbon(q, (t) => w * (1 - (1 - finish) * t));
}
