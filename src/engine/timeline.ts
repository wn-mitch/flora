// A painting's timeline: when each part of a scene is laid down, as the
// growth front u (pt of growth, clock.ts) passes. A painter recording one
// (Painter.lay) wraps what it paints in timed groups, each carrying the
// sweeps that lay it down:
//
//   line  a brush or pen moving along a polyline: the part within `half`
//         of the line up to the pen shows, the pen moving from b to b + d
//   disc  paint spreading out from a point to radius r
//   gate  nothing, then everything, at b
//
// A frame at u shows a group whole once every sweep is done, nothing before
// any starts, and in between only what lies inside the sweeps' shapes, as
// a clip. A lone sweep with a wet front shows the band just behind the pen
// paler, as paint still wet. Timed groups nest as clips do: what is inside
// two shows where both have reached. A group painted in parts
// (Painter.batched) shows its parts until all are laid down, then the
// painting done at once. Nothing else changes with u, so the last frame is
// the finished scene itself.
import type { Pt } from "./geom.ts";
import { CLOSE, LINE, MOVE, type SceneItem, type ScenePath, type Sweep } from "./paint.ts";

// The opacity of the wet band behind a pen, of the paint's own.
export const WET = 0.45;
// Sides of the polygon a disc is drawn with.
const SIDES = 16;

// How far sweep `s` has gone at u, 0-1.
export function progress(s: Sweep, u: number): number {
  if (s.kind === "gate" || s.d <= 0) return u >= s.b ? 1 : 0;
  // Done exactly at done(s), whatever (u - b) / d rounds to.
  if (u >= s.b + s.d) return 1;
  return Math.max(0, (u - s.b) / s.d);
}

// The growth by which sweep s is done.
export function done(s: Sweep): number {
  return s.kind === "gate" ? s.b : s.b + Math.max(0, s.d);
}

// The growth by which everything in `items` is laid down (0 for nothing
// timed).
export function end(items: readonly SceneItem[]): number {
  let e = 0;
  for (const it of items) {
    if (it.kind === "timed") {
      for (const s of it.sweeps) e = Math.max(e, done(s));
      e = Math.max(e, end(it.items));
      if (it.final !== undefined) e = Math.max(e, end(it.final));
    } else if (it.kind === "clip") {
      e = Math.max(e, end(it.items));
    }
  }
  return e;
}

// A path being built: a run of closed polygons, every one wound the same
// way (positive area in y-down scene coordinates), so under the nonzero
// rule they fill as their union.
class Shape {
  readonly verbs: number[] = [];
  readonly coords: number[] = [];

  get empty(): boolean {
    return this.verbs.length === 0;
  }

  poly(xs: readonly number[]): void {
    // Shoelace sum; reversed when wound the other way.
    let a = 0;
    const n = xs.length / 2;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      a += xs[2 * i] * xs[2 * j + 1] - xs[2 * j] * xs[2 * i + 1];
    }
    const fwd = a >= 0;
    for (let k = 0; k < n; k++) {
      const i = fwd ? k : n - 1 - k;
      this.verbs.push(k === 0 ? MOVE : LINE);
      this.coords.push(xs[2 * i], xs[2 * i + 1]);
    }
    this.verbs.push(CLOSE);
  }

  disc(x: number, y: number, r: number): void {
    if (r <= 0) return;
    const xs: number[] = [];
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * 2 * Math.PI;
      // The polygon's sides lie outside the circle, so it covers it.
      const rr = r / Math.cos(Math.PI / SIDES);
      xs.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    this.poly(xs);
  }

  // The band `h` either side of segment a-b.
  quad(ax: number, ay: number, bx: number, by: number, h: number): void {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0) return;
    const nx = (-dy / len) * h, ny = (dx / len) * h;
    this.poly([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]);
  }

  path(): ScenePath {
    return { verbs: this.verbs, coords: this.coords };
  }
}

// The point at arc length s along flat polyline pts (arc lengths `arc`).
function pointAt(pts: readonly number[], arc: readonly number[], s: number): Pt {
  const n = arc.length;
  if (s <= 0) return [pts[0], pts[1]];
  if (s >= arc[n - 1]) return [pts[2 * n - 2], pts[2 * n - 1]];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (arc[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - arc[lo]) / Math.max(1e-12, arc[hi] - arc[lo]);
  return [pts[2 * lo] + (pts[2 * hi] - pts[2 * lo]) * t, pts[2 * lo + 1] + (pts[2 * hi + 1] - pts[2 * lo + 1]) * t];
}

// Add to `sh` the band `h` either side of line sweep s's stretch from arc
// length s0 to s1, with a round cap at s0 when `back` and at s1 when
// `front`, and a disc at each vertex between, so it turns corners whole.
function stretch(sh: Shape, s: Sweep & { kind: "line" }, s0: number, s1: number, back: boolean, front: boolean): void {
  if (s1 <= s0) return;
  const pts = s.pts, arc = s.arc, h = s.half;
  const a = pointAt(pts, arc, s0), z = pointAt(pts, arc, s1);
  // The vertices strictly inside the stretch, no closer together than
  // a quarter of the band, so a finely sampled line makes a modest clip.
  const xs: number[] = [a[0], a[1]];
  let last = s0;
  const gap = Math.max(0.5, h * 0.25);
  for (let i = 0; i < arc.length; i++) {
    if (arc[i] <= s0 || arc[i] >= s1) continue;
    if (arc[i] - last < gap || s1 - arc[i] < gap * 0.5) continue;
    xs.push(pts[2 * i], pts[2 * i + 1]);
    last = arc[i];
  }
  xs.push(z[0], z[1]);
  const n = xs.length / 2;
  for (let k = 0; k + 1 < n; k++) sh.quad(xs[2 * k], xs[2 * k + 1], xs[2 * k + 2], xs[2 * k + 3], h);
  for (let k = 1; k + 1 < n; k++) sh.disc(xs[2 * k], xs[2 * k + 1], h);
  if (back) sh.disc(a[0], a[1], h);
  if (front) sh.disc(z[0], z[1], h);
}

// How far along a paced line the pen is at u: the arc length where its
// times reach u.
export function penAt(arc: readonly number[], times: readonly number[], u: number): number {
  const n = times.length;
  if (u <= times[0]) return 0;
  if (u >= times[n - 1]) return arc[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] <= u) lo = mid;
    else hi = mid;
  }
  const dt = times[hi] - times[lo];
  return dt <= 0 ? arc[hi] : arc[lo] + ((arc[hi] - arc[lo]) * (u - times[lo])) / dt;
}

// What a timed group shows at u: nothing, all of it, all of it at a share
// `alpha` of its opacity, or the part inside `main` and, paler, the part
// inside `band`.
export type Reveal =
  | { readonly kind: "hidden" }
  | { readonly kind: "whole" }
  | { readonly kind: "clipped"; readonly main: ScenePath | undefined; readonly band: ScenePath | undefined };

const HIDDEN: Reveal = { kind: "hidden" };
const WHOLE: Reveal = { kind: "whole" };

// What sweeps show at u.
export function reveal(sweeps: readonly Sweep[], u: number): Reveal {
  let all = true, any = false;
  for (const s of sweeps) {
    const k = progress(s, u);
    if (k < 1) all = false;
    if (k > 0) any = true;
  }
  if (all) return WHOLE;
  if (!any) return HIDDEN;
  const main = new Shape(), band = new Shape();
  const lone = sweeps.length === 1;
  for (const s of sweeps) {
    const k = progress(s, u);
    if (k <= 0) continue;
    if (s.kind === "line") {
      const len = s.arc[s.arc.length - 1];
      if (k >= 1) {
        stretch(main, s, 0, len, true, true);
        continue;
      }
      const at = s.times !== undefined ? penAt(s.arc, s.times, u) : len * k;
      const wet = lone ? Math.min(s.wet, at) : 0;
      if (wet > 0) {
        stretch(main, s, 0, at - wet, true, false);
        stretch(band, s, at - wet, at, at - wet <= 0, true);
      } else {
        stretch(main, s, 0, at, true, true);
      }
    } else if (s.kind === "disc") {
      // Paint spreads fast at first and slows as it reaches its edge.
      const q = 1 - k;
      const r = s.r * (1 - q * q);
      const wet = lone && k < 1 ? Math.min(s.wet, r) : 0;
      main.disc(s.x, s.y, r - wet);
      if (wet > 0) {
        // The ring: its outer edge, then its inner edge wound the other
        // way, so the nonzero rule leaves the middle out.
        const outer = new Shape(), inner = new Shape();
        outer.disc(s.x, s.y, r);
        inner.disc(s.x, s.y, r - wet);
        for (let i = 0; i < outer.verbs.length; i++) band.verbs.push(outer.verbs[i]);
        for (let i = 0; i < outer.coords.length; i++) band.coords.push(outer.coords[i]);
        const ic = inner.coords, m = ic.length / 2;
        for (let i = 0; i < m; i++) {
          band.verbs.push(i === 0 ? MOVE : LINE);
          band.coords.push(ic[2 * (m - 1 - i)], ic[2 * (m - 1 - i) + 1]);
        }
        band.verbs.push(CLOSE);
      }
    }
  }
  return { kind: "clipped", main: main.empty ? undefined : main.path(), band: band.empty ? undefined : band.path() };
}

// `items` with every opacity scaled by k.
function paler(items: readonly SceneItem[], k: number): SceneItem[] {
  const out: SceneItem[] = [];
  for (const it of items) {
    if (it.kind === "fill") out.push({ kind: "fill", path: it.path, paint: it.paint, rule: it.rule, alpha: it.alpha * k, blend: it.blend });
    else if (it.kind === "stroke") out.push({ kind: "stroke", path: it.path, rgb: it.rgb, width: it.width, alpha: it.alpha * k, blend: it.blend });
    else if (it.kind === "clip") out.push({ kind: "clip", path: it.path, rule: it.rule, items: paler(it.items, k) });
    else out.push({ kind: "timed", sweeps: it.sweeps, items: paler(it.items, k), final: it.final === undefined ? undefined : paler(it.final, k) });
  }
  return out;
}

// The scene items of a frame at growth u: plain fills, strokes and clips,
// with no timed groups left.
export function frame(items: readonly SceneItem[], u: number): SceneItem[] {
  const out: SceneItem[] = [];
  for (const it of items) {
    if (it.kind === "clip") {
      const inner = frame(it.items, u);
      if (inner.length > 0) out.push({ kind: "clip", path: it.path, rule: it.rule, items: inner });
    } else if (it.kind === "timed" && it.final !== undefined) {
      for (const x of frame(u >= end([it]) ? it.final : it.items, u)) out.push(x);
    } else if (it.kind === "timed") {
      const r = reveal(it.sweeps, u);
      if (r.kind === "hidden") continue;
      if (r.kind === "whole") {
        for (const x of frame(it.items, u)) out.push(x);
        continue;
      }
      if (r.main !== undefined) {
        const inner = frame(it.items, u);
        if (inner.length > 0) out.push({ kind: "clip", path: r.main, rule: "nonzero", items: inner });
      }
      if (r.band !== undefined) {
        const inner = frame(paler(it.items, WET), u);
        if (inner.length > 0) out.push({ kind: "clip", path: r.band, rule: "nonzero", items: inner });
      }
    } else {
      out.push(it);
    }
  }
  return out;
}

// The finished scene: every timed group's items in its place.
export function finished(items: readonly SceneItem[]): SceneItem[] {
  const out: SceneItem[] = [];
  for (const it of items) {
    if (it.kind === "timed") for (const x of finished(it.final ?? it.items)) out.push(x);
    else if (it.kind === "clip") out.push({ kind: "clip", path: it.path, rule: it.rule, items: finished(it.items) });
    else out.push(it);
  }
  return out;
}
