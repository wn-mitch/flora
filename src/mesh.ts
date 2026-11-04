// A timeline's window as a mesh a renderer draws any of its frames from
// without rebuilding (meshgl.ts). Every item becomes triangles covering
// what it paints, in paint order. Every timed group whose sweeps lay it
// down in place (lines and discs) gets a mask: the shape of its sweeps,
// each vertex carrying when the pen reaches it (its band time) and when
// the paint there is no longer wet (its main time). A frame at u draws
// what is laid down and, for a group part laid down, its items inside the
// part of its mask u has reached: as timeline.ts clips them, but with the
// clip's shape fixed and only u changing.

import type { Blend, Fill, Paint, Stroke } from "./display.ts";
import type { Sweep } from "./engine/paint.ts";
import { done, penAt, progress, WET } from "./engine/timeline.ts";
import { flatten, pathBox, type View } from "./flatten.ts";
import { fillTriangles, strokeTriangles, type Sink } from "./tess.ts";
import type { Node, Timeline } from "./timeline.ts";

// Floats per item vertex: x, y (device px, before any offset), item; per
// mask vertex: x, y, band and main times.
export const VERTEX = 3, MASK = 4;
// Floats per item: r, g, b (straight), alpha; blend, gradient (-1 for
// none), 0, 0.
export const ITEM = 8;
// Floats per gradient: from x, y, to x, y (device px); stops, 0, 0, 0; then
// MAX_STOPS stops of r, g, b, offset.
export const MAX_STOPS = 8;
export const GRADIENT = 8 + 4 * MAX_STOPS;
// A time before any growth.
const EARLY = -1e30;

// Blends by number, as items carry them.
export const BLENDS: readonly Blend[] = ["normal", "multiply", "screen"];

// The mesh's tree, in paint order:
//   items  items a to b - 1, whose vertices run from `at[a]` to `at[b]`
//   clip   kids drawn inside a clip, whose mask triangles are `first`,
//          `count` long
//   timed  a group whose sweeps lay it down: hidden until one starts, in
//          its mask while they run (`first`, `count`; `wet` when its band
//          shows pale), whole once they are done
//   batch  a group painted in parts (`kids`), shown once laid down by its
//          painting done at once (`final`)
export type MeshNode =
  | { readonly t: "items"; readonly a: number; readonly b: number }
  | { readonly t: "clip"; readonly first: number; readonly count: number; readonly kids: readonly MeshNode[] }
  | { readonly t: "timed"; readonly sweeps: readonly Sweep[]; readonly start: number; readonly end: number; readonly first: number; readonly count: number; readonly wet: boolean; readonly kids: readonly MeshNode[] }
  | { readonly t: "batch"; readonly end: number; readonly kids: readonly MeshNode[]; readonly final: readonly MeshNode[] };

export interface Mesh {
  readonly scale: number;
  // Item vertices, and each item's first (the last entry ends the last).
  readonly verts: Float32Array;
  readonly at: Uint32Array;
  readonly blends: Uint8Array;
  readonly items: Float32Array;
  readonly gradients: Float32Array;
  readonly masks: Float32Array;
  readonly tree: readonly MeshNode[];
  readonly count: number;
}

class Floats implements Sink {
  data = new Float32Array(1 << 14);
  n = 0;
  room(k: number): void {
    if (this.n + k <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.n + k) size *= 2;
    const next = new Float32Array(size);
    next.set(this.data.subarray(0, this.n));
    this.data = next;
  }
  push6(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.room(6);
    const x = this.data, n = this.n;
    x[n] = a; x[n + 1] = b; x[n + 2] = c; x[n + 3] = d; x[n + 4] = e; x[n + 5] = f;
    this.n += 6;
  }
  push(...v: number[]): void {
    this.room(v.length);
    for (const x of v) this.data[this.n++] = x;
  }
  // A mask vertex: place and times.
  push4(a: number, b: number, c: number, d: number): void {
    this.room(4);
    const x = this.data, n = this.n;
    x[n] = a; x[n + 1] = b; x[n + 2] = c; x[n + 3] = d;
    this.n += 4;
  }
  get floats(): Float32Array {
    return this.data.slice(0, this.n);
  }
}

type Box = readonly [number, number, number, number];

// The mesh of timeline `tl` at `scale` device px per unit, for the window
// [x0, y0, x1, y1] (user units; all of it when omitted).
export function meshOf(tl: Timeline, scale: number, win?: Box): Mesh {
  const verts = new Floats(), items = new Floats(), gradients = new Floats(), masks = new Floats();
  const tri = new Floats();
  const at: number[] = [0];
  const blends: number[] = [];
  const view: View = { scale, x0: 0, y0: 0 };
  const meets = (b: Box) => win === undefined || (b[0] <= win[2] && win[0] <= b[2] && b[1] <= win[3] && win[1] <= b[3]);
  // The window in device px, a pixel wider each side.
  const dev: Box | undefined = win === undefined ? undefined : [win[0] * scale - 1, win[1] * scale - 1, win[2] * scale + 1, win[3] * scale + 1];

  const item = (it: Fill | Stroke): boolean => {
    const box = pathBox(it.path);
    if (box === null) return false;
    const pad = it.kind === "stroke" ? it.width / 2 : 0;
    if (!meets([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad])) return false;
    tri.n = 0;
    const hw = it.kind === "stroke" ? Math.max(it.width * scale, 1) / 2 : 0;
    let subs = flatten(it.path, view);
    // Subpaths that cannot reach the window paint nothing in it, nor
    // change the winding of what does.
    if (dev !== undefined) subs = subs.filter((p) => reach(p, hw, dev));
    if (it.kind === "fill") fillTriangles(subs, it.rule, tri, dev);
    else for (const p of subs) strokeTriangles(p, hw, tri, dev);
    if (tri.n === 0) return false;
    const k = blends.length;
    const b = BLENDS.indexOf(it.blend);
    const paint: Paint = it.kind === "fill" ? it.paint : { kind: "solid", rgb: it.rgb };
    let g = -1;
    if (paint.kind === "linear") {
      if (paint.stops.length > MAX_STOPS) throw new Error(`mesh: a gradient has more than ${MAX_STOPS} stops`);
      g = gradients.n / GRADIENT;
      gradients.push(paint.from[0] * scale, paint.from[1] * scale, paint.to[0] * scale, paint.to[1] * scale, paint.stops.length, 0, 0, 0);
      for (let i = 0; i < MAX_STOPS; i++) {
        const s = paint.stops[Math.min(i, paint.stops.length - 1)];
        gradients.push(s.rgb[0], s.rgb[1], s.rgb[2], s.offset);
      }
    }
    const rgb = paint.kind === "solid" ? paint.rgb : [0, 0, 0];
    items.push(rgb[0], rgb[1], rgb[2], it.alpha, b, g, 0, 0);
    blends.push(b);
    verts.room((tri.n / 2) * VERTEX);
    const d = tri.data, v = verts.data;
    for (let i = 0; i < tri.n; i += 2) {
      const n = verts.n;
      v[n] = d[i]; v[n + 1] = d[i + 1]; v[n + 2] = k;
      verts.n += VERTEX;
    }
    at.push(verts.n / VERTEX);
    return true;
  };

  // `list` as mesh nodes, runs of items joined.
  const walk = (list: readonly Node[]): MeshNode[] => {
    const out: MeshNode[] = [];
    const add = (a: number, b: number) => {
      if (b === a) return;
      const last = out[out.length - 1];
      if (last !== undefined && last.t === "items" && last.b === a) out[out.length - 1] = { t: "items", a: last.a, b };
      else out.push({ t: "items", a, b });
    };
    for (const n of list) {
      if (n.kind === "fill" || n.kind === "stroke") {
        const a = blends.length;
        if (item(n)) add(a, blends.length);
        continue;
      }
      if (!meets(n.box)) continue;
      if (n.kind === "clip") {
        const first = masks.n / MASK;
        tri.n = 0;
        fillTriangles(flatten(n.path, view), n.rule, tri);
        for (let i = 0; i < tri.n; i += 2) masks.push4(tri.data[i], tri.data[i + 1], EARLY, EARLY);
        const count = masks.n / MASK - first;
        if (count === 0) continue; // an empty clip shows nothing
        const kids = walk(n.items);
        if (kids.length > 0) out.push({ t: "clip", first, count, kids });
        continue;
      }
      if (n.final !== undefined) {
        const kids = walk(n.items), final = walk(n.final);
        if (kids.length > 0 || final.length > 0) out.push({ t: "batch", end: n.end, kids, final });
        continue;
      }
      if (n.sweeps.length === 0) {
        for (const k of walk(n.items)) {
          if (k.t === "items") add(k.a, k.b);
          else out.push(k);
        }
        continue;
      }
      let start = Infinity, end = -Infinity;
      for (const s of n.sweeps) {
        start = Math.min(start, s.b);
        end = Math.max(end, done(s));
      }
      const first = masks.n / MASK;
      const lone = n.sweeps.length === 1;
      for (const s of n.sweeps) mask(s, lone, scale, win, masks);
      const count = masks.n / MASK - first;
      const kids = walk(n.items);
      const wet = lone && n.sweeps[0].kind !== "gate" && n.sweeps[0].wet > 0;
      if (kids.length > 0) out.push({ t: "timed", sweeps: n.sweeps, start, end, first, count, wet, kids });
    }
    return out;
  };
  const tree = walk(tl.root);
  return {
    scale, verts: verts.floats, at: Uint32Array.from(at), blends: Uint8Array.from(blends), items: items.floats,
    gradients: gradients.floats, masks: masks.floats, tree, count: blends.length,
  };
}

// What a frame draws, in order (walkFrame): runs of items at a share
// `pale` of their opacity, and masks entered and left. A mask is a clip
// (mode 0, all of it), what a group has laid down (mode 1, its points
// whose main time u has reached) or its wet front (mode 2, those whose
// band time u has reached but not their main); `depth` is how many masks
// it lies in.
export interface FrameVisitor {
  items(a: number, b: number, pale: number): void;
  enter(first: number, count: number, mode: 0 | 1 | 2, depth: number): void;
  leave(first: number, count: number, mode: 0 | 1 | 2, depth: number): void;
}

// The frame of `mesh` at growth u, as timeline.ts makes it: a group whole
// once its sweeps are done and hidden before any starts, else its items
// drawn inside what it has laid down and, paler, its wet front; a batch's
// parts until it is laid down, then its painting done at once.
export function walkFrame(mesh: Mesh, u: number, v: FrameVisitor): void {
  const walk = (list: readonly MeshNode[], depth: number, pale: number) => {
    for (const n of list) {
      if (n.t === "items") v.items(n.a, n.b, pale);
      else if (n.t === "clip") inside(n.first, n.count, 0, n.kids, depth, pale);
      else if (n.t === "batch") walk(u >= n.end ? n.final : n.kids, depth, pale);
      else if (u >= n.end) walk(n.kids, depth, pale);
      else if (n.count > 0 && n.sweeps.some((s) => progress(s, u) > 0)) {
        if (!n.wet || !allWet(n.sweeps[0], u)) inside(n.first, n.count, 1, n.kids, depth, pale);
        if (n.wet) inside(n.first, n.count, 2, n.kids, depth, pale * WET);
      }
    }
  };
  const inside = (first: number, count: number, mode: 0 | 1 | 2, kids: readonly MeshNode[], depth: number, pale: number) => {
    v.enter(first, count, mode, depth);
    walk(kids, depth + 1, pale);
    v.leave(first, count, mode, depth);
  };
  walk(mesh.tree, 0, 1);
}

// Whether all that lone sweep s has laid down at u is still wet, so it has
// no dry part to draw (timeline.reveal's main shape is empty).
function allWet(s: Sweep, u: number): boolean {
  const k = progress(s, u);
  if (k >= 1 || s.kind === "gate") return false;
  if (s.kind === "disc") {
    const q = 1 - k;
    return s.r * (1 - q * q) <= s.wet;
  }
  const len = s.arc[s.arc.length - 1];
  const at = s.times !== undefined ? penAt(s.arc, s.times, u) : len * k;
  return at <= s.wet;
}

// Whether polyline p, grown by pad, reaches box b.
function reach(p: Float32Array, pad: number, b: Box): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 + pad >= b[0] && x0 - pad <= b[2] && y1 + pad >= b[1] && y0 - pad <= b[3];
}

// The most rings a disc's mask is made of, and sides of any disc; device
// px per ring, and per side round a disc's edge.
const RINGS = 8, SIDES = 16, RING_PX = 6, SIDE_PX = 3;
// Sides for a disc of radius r device px.
const sidesFor = (r: number): number => Math.max(6, Math.min(SIDES, Math.ceil((2 * Math.PI * r) / SIDE_PX)));
// The turn (cosine) past which a line's mask puts a disc at the corner:
// where the gap between its quads opens past a fraction of a pixel.
const turned = (h: number): number => Math.cos(Math.min(0.5, 0.4 / Math.max(h, 0.4)));

// The mask of sweep s, device px, into `out`: for a line, a quad along each
// side and a disc at each end and wherever it turns, so it covers its band
// as timeline.reveal's does; for a disc, rings out to its radius. A gate
// lays nothing down in place. Only what reaches window `win` (user units)
// is made.
function mask(s: Sweep, lone: boolean, scale: number, win: Box | undefined, out: Floats): void {
  if (s.kind === "gate") return;
  // Whether the box round (x0, y0)-(x1, y1) grown by r meets the window.
  const near = (x0: number, y0: number, x1: number, y1: number, r: number) => win === undefined
    || (Math.min(x0, x1) - r <= win[2] && Math.max(x0, x1) + r >= win[0] && Math.min(y0, y1) - r <= win[3] && Math.max(y0, y1) + r >= win[1]);
  if (s.kind === "disc") {
    const cx = s.x * scale, cy = s.y * scale, R = s.r * scale;
    if (R <= 0 || !near(s.x, s.y, s.x, s.y, s.r)) return;
    // The ring between rho0 and rho1 (user units), times at each radius.
    const time = (rho: number) => (rho >= s.r || s.d <= 0 ? done(s) : s.b + s.d * (1 - Math.sqrt(1 - rho / s.r)));
    const wet = lone ? s.wet : 0;
    const rings = Math.max(2, Math.min(RINGS, Math.ceil(R / RING_PX))), sides = sidesFor(R);
    // The polygon's sides lie outside the circle, so it covers it.
    const grow = 1 / Math.cos(Math.PI / sides);
    for (let r = 0; r < rings; r++) {
      const p0 = (s.r * r) / rings, p1 = (s.r * (r + 1)) / rings;
      const b0 = time(p0), b1 = time(p1), m0 = time(p0 + wet), m1 = time(p1 + wet);
      const q0 = p0 * scale * (r === 0 ? 1 : grow), q1 = p1 * scale * grow;
      for (let j = 0; j < sides; j++) {
        const a0 = (j / sides) * 2 * Math.PI, a1 = ((j + 1) / sides) * 2 * Math.PI;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        out.push4(cx + c0 * q0, cy + s0 * q0, b0, m0); out.push4(cx + c0 * q1, cy + s0 * q1, b1, m1); out.push4(cx + c1 * q1, cy + s1 * q1, b1, m1);
        if (r > 0) { out.push4(cx + c0 * q0, cy + s0 * q0, b0, m0); out.push4(cx + c1 * q1, cy + s1 * q1, b1, m1); out.push4(cx + c1 * q0, cy + s1 * q0, b0, m0); }
      }
    }
    return;
  }
  const { pts, arc } = s;
  const n = arc.length, len = arc[n - 1];
  if (n < 2) return;
  const times = s.times ?? arc.map((a) => s.b + (len > 0 ? (a / len) * s.d : 0));
  // When the pen reaches arc length a (done past the end).
  const timeAt = (a: number): number => {
    if (a >= len) return done(s);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arc[mid] <= a) lo = mid;
      else hi = mid;
    }
    const da = arc[hi] - arc[lo];
    return da <= 0 ? times[hi] : times[lo] + ((times[hi] - times[lo]) * (a - arc[lo])) / da;
  };
  const wet = lone ? s.wet : 0;
  const main = times.map((t, i) => (wet > 0 ? timeAt(arc[i] + wet) : t));
  const h = s.half * scale;
  const x = (i: number) => pts[2 * i] * scale, y = (i: number) => pts[2 * i + 1] * scale;
  const sides = sidesFor(h), corner = turned(h);
  const disc = (i: number) => {
    if (!near(pts[2 * i], pts[2 * i + 1], pts[2 * i], pts[2 * i + 1], s.half)) return;
    const cx = x(i), cy = y(i), r = h / Math.cos(Math.PI / sides);
    for (let j = 0; j < sides; j++) {
      const a0 = (j / sides) * 2 * Math.PI, a1 = ((j + 1) / sides) * 2 * Math.PI;
      out.push4(cx, cy, times[i], main[i]); out.push4(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, times[i], main[i]); out.push4(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, times[i], main[i]);
    }
  };
  let dx0 = 0, dy0 = 0;
  for (let i = 0; i + 1 < n; i++) {
    const ax = x(i), ay = y(i), bx = x(i + 1), by = y(i + 1);
    const dx = bx - ax, dy = by - ay;
    const l = Math.hypot(dx, dy);
    if (l === 0) continue;
    if (!near(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], s.half)) {
      dx0 = dx;
      dy0 = dy;
      continue;
    }
    const nx = (-dy / l) * h, ny = (dx / l) * h;
    const ta = times[i], tb = times[i + 1], ma = main[i], mb = main[i + 1];
    out.push4(ax + nx, ay + ny, ta, ma); out.push4(bx + nx, by + ny, tb, mb); out.push4(bx - nx, by - ny, tb, mb);
    out.push4(ax + nx, ay + ny, ta, ma); out.push4(bx - nx, by - ny, tb, mb); out.push4(ax - nx, ay - ny, ta, ma);
    // A disc where the line turns enough to open a gap between its quads.
    if (i > 0 && (dx0 !== 0 || dy0 !== 0) && (dx0 * dx + dy0 * dy) / (Math.hypot(dx0, dy0) * l) < corner) disc(i);
    dx0 = dx;
    dy0 = dy;
  }
  disc(0);
  disc(n - 1);
}
