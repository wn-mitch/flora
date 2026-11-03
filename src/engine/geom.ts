// Plane geometry for the generator. Points are [x, y] in TeX points; paths
// are command lists: ["m", x, y], ["l", x, y], ["c", x1, y1, x2, y2, x, y],
// ["o", x, y, r] (a circle) and ["z"].
import { hypot, mod, sortNumbers } from "#platform";
import type { Rng } from "./rng.ts";

export type Pt = [number, number];
export type Cmd =
  | ["m", number, number]
  | ["l", number, number]
  | ["c", number, number, number, number, number, number]
  | ["o", number, number, number]
  | ["z"];

const PI = Math.PI;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dist(p: Pt, q: Pt): number {
  return hypot(q[0] - p[0], q[1] - p[1]);
}

export function angle(p: Pt, q: Pt): number {
  return Math.atan2(q[1] - p[1], q[0] - p[0]);
}

export function polar(p: Pt, ang: number, r: number): Pt {
  return [p[0] + r * Math.cos(ang), p[1] + r * Math.sin(ang)];
}

export function mix(p: Pt, q: Pt, t: number): Pt {
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

// Rotate by `ang`, scale by `sx` and `sy` (default sx), then translate to
// (ox, oy).
export function transform(pts: readonly Pt[], ox: number, oy: number, ang = 0, sx = 1, sy = sx): Pt[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map((p): Pt => {
    const x = p[0] * sx, y = p[1] * sy;
    return [ox + x * c - y * s, oy + x * s + y * c];
  });
}

// Scale a polygon toward (cx, cy).
export function toward(pts: readonly Pt[], cx: number, cy: number, s: number): Pt[] {
  return pts.map((p): Pt => [cx + (p[0] - cx) * s, cy + (p[1] - cy) * s]);
}

// [x0, y0, x1, y1]; infinite and inverted for no points.
export function bbox(pts: readonly Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

// Signed area, positive counter-clockwise in y-up coordinates.
export function area(pts: readonly Pt[]): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1 < n ? i + 1 : 0];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(pts: readonly Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

// A sampler of points inside `pts` (even-odd rule), close to uniform by
// area. The polygon is cut into horizontal rows `h` pt tall; each row's
// inside spans are found once, then a sample picks a row by its inside
// length, a span within it and a point in that span. Points may stray up to
// h/2 past the outline vertically, so use it for paint that is clipped.
// Undefined for a degenerate polygon.
export function spanSampler(pts: readonly Pt[], h: number): ((rng: Rng) => Pt | undefined) | undefined {
  const [, y0, , y1] = bbox(pts);
  const n = pts.length;
  const rows: { y: number; xs: number[] }[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let y = y0 + h / 2; y <= y1; y += h) {
    const xs: number[] = [];
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[j];
      if (a[1] > y !== b[1] > y) xs.push(((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]);
      j = i;
    }
    sortNumbers(xs);
    let len = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) len += xs[k + 1] - xs[k];
    if (len > 0) {
      total += len;
      rows.push({ y, xs });
      cum.push(total);
    }
  }
  if (total <= 0) return undefined;
  return (rng) => {
    const u = rng.next() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cum[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    const row = rows[lo];
    let into = u - (lo > 0 ? cum[lo - 1] : 0);
    const xs = row.xs;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      // The last span takes whatever rounding left over.
      if (into <= w || k + 3 >= xs.length) return [xs[k] + Math.min(into, w), row.y + (rng.next() - 0.5) * h];
      into -= w;
    }
    return undefined;
  };
}

// Even-odd point-in-polygon test.
export function inside(pts: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  const n = pts.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    j = i;
  }
  return c;
}

// Smooth value noise with period `period`: f(x) in [-1, 1]. Periodic, so
// a closed contour can wobble without a seam.
export function noise(rng: Rng, period = 64): (x: number) => number {
  const v: number[] = [];
  for (let i = 0; i < period; i++) v.push(rng.next() * 2 - 1);
  return (x) => {
    const i = Math.floor(x);
    let f = x - i;
    const a = v[mod(i, period)], b = v[mod(i + 1, period)];
    f = f * f * (3 - 2 * f);
    return a + (b - a) * f;
  };
}

// Two octaves of periodic noise.
export function fbm(rng: Rng, period: number): (x: number) => number {
  const n1 = noise(rng, period), n2 = noise(rng, period * 2);
  return (x) => 0.7 * n1(x) + 0.3 * n2(x * 2);
}

// A Catmull-Rom spline through `pts`, as Bezier commands.
export function smooth(pts: readonly Pt[], closed: boolean, tension = 1): Cmd[] {
  const k = tension / 6;
  const n = pts.length;
  const cmds: Cmd[] = [["m", pts[0][0], pts[0][1]]];
  if (n < 3) {
    for (let i = 1; i < n; i++) cmds.push(["l", pts[i][0], pts[i][1]]);
    if (closed) cmds.push(["z"]);
    return cmds;
  }
  const at = (i: number) => (closed ? pts[mod(i, n)] : pts[clamp(i, 0, n - 1)]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    cmds.push([
      "c",
      p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k,
      p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k,
      p2[0], p2[1],
    ]);
  }
  if (closed) cmds.push(["z"]);
  return cmds;
}

export function polyline(pts: readonly Pt[], closed: boolean): Cmd[] {
  const cmds: Cmd[] = [["m", pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) cmds.push(["l", pts[i][0], pts[i][1]]);
  if (closed) cmds.push(["z"]);
  return cmds;
}

// A polyline densified by Catmull-Rom interpolation, `per` samples a span.
export function splinePoints(pts: readonly Pt[], per: number): Pt[] {
  const n = pts.length;
  if (n < 2) return [[pts[0][0], pts[0][1]]];
  const at = (i: number) => pts[clamp(i, 0, n - 1)];
  const out: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t * t * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

export function length(pts: readonly Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

// The point and heading at arclength fraction t of a polyline.
export function at(pts: readonly Pt[], t: number): [Pt, number] {
  let target = clamp(t, 0, 1) * length(pts);
  const n = pts.length;
  for (let i = 1; i < n; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (target <= d || i === n - 1) {
      const f = d > 0 ? clamp(target / d, 0, 1) : 0;
      return [mix(pts[i - 1], pts[i], f), angle(pts[i - 1], pts[i])];
    }
    target -= d;
  }
  return [pts[n - 1], 0];
}

// `n` points evenly spaced by arclength along a polyline: point i is
// at(pts, i / (n - 1)), with segment lengths measured once.
export function resample(pts: readonly Pt[], n: number): Pt[] {
  const m = pts.length;
  const ds: number[] = []; // ds[k - 1]: the length of segment k-1 -> k
  let total = 0;
  for (let k = 1; k < m; k++) {
    const d = dist(pts[k - 1], pts[k]);
    ds.push(d);
    total += d;
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let target = clamp(i / (n - 1), 0, 1) * total;
    let p = pts[m - 1];
    for (let k = 1; k < m; k++) {
      const d = ds[k - 1];
      if (target <= d || k === m - 1) {
        p = mix(pts[k - 1], pts[k], d > 0 ? clamp(target / d, 0, 1) : 0);
        break;
      }
      target -= d;
    }
    out.push(p);
  }
  return out;
}

// A closed outline round a centreline whose half-width at fraction t is
// w(t): the left side out, the right side back.
// Where a point's neighbours coincide (closer than 1e-9 pt) the heading
// carries over from the point before (0 at the start), so a line of one
// repeated point still gets a fixed normal rather than one rounding noise
// picks.
export function ribbon(pts: readonly Pt[], w: (t: number) => number): Pt[] {
  const n = pts.length;
  const left: Pt[] = [], right: Pt[] = [];
  let heading = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 1e-9) heading = angle(a, b);
    const ang = heading + PI / 2;
    const hw = w(i / (n - 1));
    left.push(polar(pts[i], ang, hw));
    right.push(polar(pts[i], ang, -hw));
  }
  for (let i = n - 1; i >= 0; i--) left.push(right[i]);
  return left;
}

// Each vertex displaced by smooth noise; for wash layers.
export function deform(pts: readonly Pt[], rng: Rng, amp: number): Pt[] {
  const nz = noise(rng, pts.length), nz2 = noise(rng, pts.length);
  return pts.map((p, i): Pt => {
    const x = i * 0.35;
    return [p[0] + amp * nz(x), p[1] + amp * nz2(x)];
  });
}

// A stem-like curve from p heading `ang`, bending by `bend` radians over its
// length and curling by `curl` near the end: n + 1 sample points.
export function curve(p: Pt, ang: number, len: number, bend: number, curl = 0, n = 24): Pt[] {
  const pts: Pt[] = [[p[0], p[1]]];
  let x = p[0], y = p[1];
  const step = len / n;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const a = ang + bend * t + curl * t ** 4;
    x += step * Math.cos(a);
    y += step * Math.sin(a);
    pts.push([x, y]);
  }
  return pts;
}

// A curve grown from p at `heading` whose curvature (radians per pt) at
// fraction t of its length is kfun(t). Heading changes only through
// curvature, so the curve has no corners. Returns the points and the final
// heading.
export function flow(p: Pt, heading: number, len: number, kfun: (t: number) => number, n?: number): [Pt[], number] {
  if (n === undefined) {
    // Enough steps that none turns more than about 7 degrees, judged by
    // the sharpest curvature along the curve.
    let kmax = 0;
    for (let i = 0; i < 64; i++) kmax = Math.max(kmax, Math.abs(kfun((i + 0.5) / 64)));
    n = Math.max(8, Math.ceil(len / 1.5), Math.ceil((len * kmax) / 0.12));
  }
  const step = len / n;
  let x = p[0], y = p[1], a = heading;
  const pts: Pt[] = [[x, y]];
  for (let i = 1; i <= n; i++) {
    a += kfun((i - 0.5) / n) * step;
    x += step * Math.cos(a);
    y += step * Math.sin(a);
    pts.push([x, y]);
  }
  return [pts, a];
}

// The c for which curvature c * t^pw over `len` turns `turns` full circles.
export function curlCoefficient(len: number, turns: number, pw: number): number {
  return (2 * PI * turns * (pw + 1)) / len;
}

export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

// A smooth stem from p0, leaving along heading dir0, to p1, arriving along
// dir1. Handles are a fraction `k` of the chord, so a branch peels off its
// parent tangentially and sweeps into its target.
export function link(p0: Pt, dir0: number, p1: Pt, dir1: number, k = 0.5, n?: number): Pt[] {
  const h = dist(p0, p1) * k;
  return bezier(p0, polar(p0, dir0, h), polar(p1, dir1 + PI, h), p1, n ?? Math.max(12, Math.ceil(dist(p0, p1) / 1.2)));
}

// The smallest signed difference a - b, in (-pi, pi].
export function turn(a: number, b: number): number {
  let d = mod(a - b, 2 * PI);
  if (d > PI) d -= 2 * PI;
  return d;
}

// The heading a branch takes off a stem with tangent `along`: whichever way
// along the stem faces the target, turned by `bias` toward it.
export function depart(p: Pt, along: number, target: Pt, bias = 0.3): number {
  const want = angle(p, target);
  const fwd = Math.abs(turn(want, along)) <= PI / 2 ? along : along + PI;
  const side = turn(want, fwd) >= 0 ? 1 : -1;
  return fwd + side * bias;
}

export interface Pursuit {
  readonly len: number;
  readonly step?: number;
  readonly kmax?: number;
  readonly dk?: number;
  readonly k0?: number;
  readonly stop?: (q: Pt) => boolean;
}

// A stem grown by steering, as a plant grows, rather than fitted through
// points. From p along `heading`, each step of o.step pt turns toward the
// point target(q, s, heading) gives (pure pursuit: the curvature that would
// arc onto it). Curvature is held to o.kmax (1/pt) and changes by at most
// o.dk per pt, so bends build and relax gradually. Growth stops after o.len
// pt, when target gives undefined, or when o.stop(q) is true. Returns the
// points and the final heading.
export function pursue(p: Pt, heading: number, target: (q: Pt, s: number, heading: number) => Pt | undefined, o: Pursuit): [Pt[], number] {
  const step = o.step ?? 2, kmax = o.kmax ?? 1 / 30, dk = o.dk ?? 1 / 900;
  const pts: Pt[] = [[p[0], p[1]]];
  let a = heading, k = o.k0 ?? 0, s = 0, x = p[0], y = p[1];
  while (s < o.len) {
    const t = target([x, y], s, a);
    if (t === undefined) break;
    const d = Math.max(1e-6, dist([x, y], t));
    const want = clamp((2 * Math.sin(turn(angle([x, y], t), a))) / d, -kmax, kmax);
    k += clamp(want - k, -dk * step, dk * step);
    a += k * step;
    x += step * Math.cos(a);
    y += step * Math.sin(a);
    if (o.stop && o.stop([x, y])) break;
    pts.push([x, y]);
    s += step;
  }
  return [pts, a];
}

// A target for pursue that leads along polyline `guide`: the grower's
// nearest guide point is tracked (never backward), and the target lies
// `ahead` pt further along the guide. Undefined once the grower is within
// `finish` pt of the guide's end.
export function follow(guide: readonly Pt[], ahead: number, finish = 2): (q: Pt) => Pt | undefined {
  const n = guide.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(guide[i - 1], guide[i]));
  let j = 0;
  const last = guide[n - 1];
  return (q) => {
    if (dist(q, last) < finish) return undefined;
    let best = j, bd = dist(guide[j], q);
    for (let i = j + 1; i <= Math.min(n - 1, j + 40); i++) {
      const d = dist(guide[i], q);
      if (d < bd) {
        best = i;
        bd = d;
      }
    }
    j = best;
    let k = j;
    while (k < n - 1 && cum[k] - cum[j] < ahead) k++;
    return guide[k];
  };
}

// Sorts `xs` in place, stably, by key(x) ascending: an insertion sort, for
// the short lists the generator orders (petals, text lines). Lua's
// table.sort is not stable, so engine code sorts records only through this.
export function sortBy<T>(xs: T[], key: (x: T) => number): void {
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i], k = key(x);
    let j = i - 1;
    while (j >= 0 && key(xs[j]) > k) {
      xs[j + 1] = xs[j];
      j--;
    }
    xs[j + 1] = x;
  }
}
