// Paths as triangles in device px. A fill becomes trapezoids that cover
// exactly what its rule fills, each pixel once, so it can be drawn without
// a stencil pass (meshgl.ts). A stroke becomes quads along its polyline
// and discs at its vertices, which overlap; renderers draw it once per
// pixel by stencil (webgl.ts) or by depth (meshgl.ts).

import type { Rule } from "./display.ts";

// Where triangles go: six floats, the three corners' x and y.
export interface Sink {
  push6(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

// The edges of the fill being cut, five floats apiece: x0, y0, x1, y1
// (top, the smaller y, first) and its winding, +1 going down the page in
// the path's order, -1 going up. Scratch, grown as needed.
let E = new Float64Array(5 * 256);

// Where edge e crosses height y. Every slab works an edge's x out from
// these same numbers, so trapezoids sharing a side share its corners
// exactly.
function xAt(e: number, y: number): number {
  const k = 5 * e, y0 = E[k + 1], y1 = E[k + 3];
  return y <= y0 ? E[k] : y >= y1 ? E[k + 2] : E[k] + ((y - y0) * (E[k + 2] - E[k])) / (y1 - y0);
}

// Most times one slab is split where its edges cross, before the rest are
// taken as they lie at its middle.
const MAX_SPLITS = 64;

// The region polylines `subs` (each closed back to its start) fill under
// `rule`, as triangles into `out`. Subpaths whose boxes do not meet cannot
// change each other's winding, so they are cut apart: a convex subpath on
// its own becomes a fan, any other group trapezoids.
// Under nonzero, subpaths meeting others whose windings all have one sign
// fill just their union, which a renderer drawing each pixel once per item
// draws from their triangles taken one by one; others are cut together.
// Given a window [x0, y0, x1, y1] (device px), triangles that cannot reach
// it are left out.
export function fillTriangles(subs: readonly Float32Array[], rule: Rule, out: Sink, win?: Window): void {
  clip = win;
  const one = new Triangles();
  for (const group of clusters(subs)) {
    if (group.length > 1 && rule === "nonzero") {
      one.n = 0;
      let signs = 0;
      for (const p of group) signs |= convex(p) ? fan(p, one) : trapezoids([p], rule, one);
      if (signs !== 3) {
        one.into(out);
        continue;
      }
    }
    if (group.length === 1 && convex(group[0])) fan(group[0], out);
    else trapezoids(group, rule, out);
  }
}

// A window, device px, and the one fillTriangles is cutting for.
type Window = readonly [number, number, number, number];
let clip: Window | undefined;

// Triangles kept to be handed on or dropped.
class Triangles implements Sink {
  data: number[] = [];
  n = 0;
  push6(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const x = this.data, n = this.n;
    x[n] = a; x[n + 1] = b; x[n + 2] = c; x[n + 3] = d; x[n + 4] = e; x[n + 5] = f;
    this.n += 6;
  }
  into(out: Sink): void {
    const x = this.data;
    for (let i = 0; i < this.n; i += 6) out.push6(x[i], x[i + 1], x[i + 2], x[i + 3], x[i + 4], x[i + 5]);
  }
}

// Signs of winding seen in a filled region: 1 positive, 2 negative.
type Signs = number;

// Subpaths in groups whose boxes meet, through any chain of others: boxes
// go in a grid of cells about the size of a typical box, and each meets
// only those sharing a cell with it.
function clusters(subs: readonly Float32Array[]): Float32Array[][] {
  const n = subs.length;
  if (n <= 1) return n === 1 ? [[subs[0]]] : [];
  const box = new Float64Array(4 * n);
  let size = 0;
  for (let k = 0; k < n; k++) {
    const p = subs[k];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i], y = p[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    box[4 * k] = x0; box[4 * k + 1] = y0; box[4 * k + 2] = x1; box[4 * k + 3] = y1;
    size += Math.max(x1 - x0, y1 - y0);
  }
  const cell = Math.max(1, (2 * size) / n);
  const up = new Int32Array(n);
  for (let k = 0; k < n; k++) up[k] = k;
  const root = (i: number): number => {
    while (up[i] !== i) i = up[i] = up[up[i]];
    return i;
  };
  const grid = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const gx0 = Math.floor(box[4 * k] / cell), gy0 = Math.floor(box[4 * k + 1] / cell);
    const gx1 = Math.floor(box[4 * k + 2] / cell), gy1 = Math.floor(box[4 * k + 3] / cell);
    // A box spanning many cells (a large subpath) is set against the
    // others directly instead.
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 64) {
      for (let j = 0; j < n; j++) {
        if (j !== k && box[4 * j] <= box[4 * k + 2] && box[4 * k] <= box[4 * j + 2] && box[4 * j + 1] <= box[4 * k + 3] && box[4 * k + 1] <= box[4 * j + 3]) up[root(j)] = root(k);
      }
      continue;
    }
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const key = gx * 1048576 + gy;
        let c = grid.get(key);
        if (c === undefined) grid.set(key, (c = []));
        for (const j of c) {
          if (box[4 * j] <= box[4 * k + 2] && box[4 * k] <= box[4 * j + 2] && box[4 * j + 1] <= box[4 * k + 3] && box[4 * k + 1] <= box[4 * j + 3]) up[root(j)] = root(k);
        }
        c.push(k);
      }
    }
  }
  const groups = new Map<number, Float32Array[]>();
  for (let k = 0; k < n; k++) {
    const r = root(k);
    const g = groups.get(r);
    if (g === undefined) groups.set(r, [subs[k]]);
    else g.push(subs[k]);
  }
  return [...groups.values()];
}

// Whether closed polyline p is convex and turns one way only, so a fan
// from its first point covers it once.
function convex(p: Float32Array): boolean {
  let n = p.length / 2;
  if (n > 1 && p[0] === p[2 * n - 2] && p[1] === p[2 * n - 1]) n--;
  if (n < 3) return false;
  let sign = 0, turn = 0;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n, c = (i + 2) % n;
    const ux = p[2 * b] - p[2 * a], uy = p[2 * b + 1] - p[2 * a + 1];
    const vx = p[2 * c] - p[2 * b], vy = p[2 * c + 1] - p[2 * b + 1];
    const z = ux * vy - uy * vx;
    if (z !== 0) {
      if (sign === 0) sign = Math.sign(z);
      else if (Math.sign(z) !== sign) return false;
    }
    turn += Math.atan2(z, ux * vx + uy * vy);
  }
  // Once round, not twice (a star drawn in one stroke turns one way too).
  return Math.abs(Math.abs(turn) - 2 * Math.PI) < 1e-3;
}

// Whether the triangle a b c can reach the window being cut for.
function reaches(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const w = clip!;
  return Math.max(ax, bx, cx) >= w[0] && Math.min(ax, bx, cx) <= w[2] && Math.max(ay, by, cy) >= w[1] && Math.min(ay, by, cy) <= w[3];
}

// A convex polyline's fan, and the sign its winding fills with.
function fan(p: Float32Array, out: Sink): Signs {
  let area = 0;
  // A closed polyline ends on its first point, which adds no triangle.
  let end = p.length;
  if (end >= 4 && p[end - 2] === p[0] && p[end - 1] === p[1]) end -= 2;
  for (let k = 2; k + 3 < end; k += 2) {
    if (clip === undefined || reaches(p[0], p[1], p[k], p[k + 1], p[k + 2], p[k + 3])) out.push6(p[0], p[1], p[k], p[k + 1], p[k + 2], p[k + 3]);
    area += (p[k] - p[0]) * (p[k + 3] - p[1]) - (p[k + 2] - p[0]) * (p[k + 1] - p[1]);
  }
  // Edges run with y down: a positive area turns down the left side.
  return area > 0 ? 2 : area < 0 ? 1 : 0;
}

// Scratch for trapezoids: edges by top, slab heights, active edges, the
// active edges in order across a slab and their x at its top and foot.
let byTop = new Int32Array(256), ys = new Float64Array(512), active = new Int32Array(256), order = new Int32Array(256);
let xa = new Float64Array(256), xb = new Float64Array(256);

// The region of `subs` under `rule` as trapezoids: the plane is cut into
// horizontal slabs at every vertex and every crossing of edges, and within
// a slab the spans where the winding is filled become trapezoids.
function trapezoids(subs: readonly Float32Array[], rule: Rule, out: Sink): Signs {
  let m = 0;
  for (const p of subs) m += p.length / 2;
  if (E.length < 5 * m) {
    E = new Float64Array(10 * m);
    byTop = new Int32Array(2 * m);
    ys = new Float64Array(4 * m);
    active = new Int32Array(2 * m);
    order = new Int32Array(2 * m);
    xa = new Float64Array(2 * m);
    xb = new Float64Array(2 * m);
  }
  m = 0;
  for (const p of subs) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
      if (ay === by) continue;
      const k = 5 * m;
      if (ay < by) { E[k] = ax; E[k + 1] = ay; E[k + 2] = bx; E[k + 3] = by; E[k + 4] = 1; }
      else { E[k] = bx; E[k + 1] = by; E[k + 2] = ax; E[k + 3] = ay; E[k + 4] = -1; }
      m++;
    }
  }
  if (m < 2) return 0;
  const tops = byTop.subarray(0, m);
  for (let i = 0; i < m; i++) tops[i] = i;
  tops.sort((a, b) => E[5 * a + 1] - E[5 * b + 1]);
  const heights = ys.subarray(0, 2 * m);
  for (let i = 0; i < m; i++) {
    heights[2 * i] = E[5 * i + 1];
    heights[2 * i + 1] = E[5 * i + 3];
  }
  heights.sort();
  const filled = rule === "evenodd" ? (w: number) => (w & 1) !== 0 : (w: number) => w !== 0;
  let next = 0, live = 0, signs = 0;
  for (let k = 0; k + 1 < 2 * m; k++) {
    const ya = heights[k], yb = heights[k + 1];
    if (yb <= ya) continue;
    while (next < m && E[5 * tops[next] + 1] <= ya) active[live++] = tops[next++];
    let keep = 0;
    for (let i = 0; i < live; i++) if (E[5 * active[i] + 3] > ya) active[keep++] = active[i];
    live = keep;
    if (live < 2) continue;
    // A slab above or below the window paints nothing in it.
    if (clip !== undefined && (yb < clip[1] || ya > clip[3])) continue;
    signs |= slab(live, ya, yb, filled, out);
  }
  return signs;
}

// The trapezoids of slab [ya, yb] crossed by the first n active edges,
// split at the first crossing of two edges until none cross inside it.
function slab(n: number, ya: number, yb: number, filled: (w: number) => boolean, out: Sink): Signs {
  let top = ya, signs = 0;
  for (let splits = 0; top < yb; splits++) {
    // Insertion sort by x at the top, then at the foot: few edges.
    for (let i = 0; i < n; i++) {
      const e = active[i], a = xAt(e, top), b = xAt(e, yb);
      let j = i;
      while (j > 0 && (xa[j - 1] > a || (xa[j - 1] === a && xb[j - 1] > b))) {
        xa[j] = xa[j - 1];
        xb[j] = xb[j - 1];
        order[j] = order[j - 1];
        j--;
      }
      xa[j] = a;
      xb[j] = b;
      order[j] = e;
    }
    // The first height below `top` where neighbours in order swap.
    let cut = yb;
    if (splits < MAX_SPLITS) {
      for (let i = 0; i + 1 < n; i++) {
        if (xb[i + 1] >= xb[i]) continue;
        // x_p(y) = x_q(y), both linear over [top, yb].
        const da = xa[i + 1] - xa[i], db = xb[i + 1] - xb[i];
        const y = top + ((yb - top) * da) / (da - db);
        if (y > top && y < cut) cut = y;
      }
    } else {
      const mid = (top + yb) / 2;
      const o = Array.from(order.subarray(0, n)).sort((p, q) => xAt(p, mid) - xAt(q, mid));
      order.set(o);
    }
    signs |= spans(n, top, cut, filled, out);
    top = cut;
  }
  return signs;
}

// The filled spans between the first n edges of `order` over [ya, yb].
function spans(n: number, ya: number, yb: number, filled: (w: number) => boolean, out: Sink): Signs {
  if (yb <= ya) return 0;
  let w = 0, signs = 0;
  for (let i = 0; i + 1 < n; i++) {
    w += E[5 * order[i] + 4];
    if (!filled(w)) continue;
    signs |= w > 0 ? 1 : 2;
    // Join neighbouring filled spans into one trapezoid.
    let j = i + 1;
    let wj = w;
    while (j + 1 < n && filled(wj + E[5 * order[j] + 4])) {
      wj += E[5 * order[j] + 4];
      j++;
    }
    const l = order[i], r = order[j];
    const la = xAt(l, ya), lb = xAt(l, yb), ra = xAt(r, ya), rb = xAt(r, yb);
    out.push6(la, ya, ra, ya, rb, yb);
    out.push6(la, ya, rb, yb, lb, yb);
    w = wj;
    i = j - 1;
  }
  return signs;
}

// Quads along polyline `p` and, for strokes over 1.5 px wide, a disc at
// every vertex for round joins and caps; `hw` is half the width, device px.
// Given a window [x0, y0, x1, y1] (device px), quads and discs that cannot
// reach it are left out.
export function strokeTriangles(p: Float32Array, hw: number, out: Sink, win?: readonly [number, number, number, number]): void {
  const off = (x0: number, y0: number, x1: number, y1: number) => win !== undefined
    && (Math.max(x0, x1) + hw < win[0] || Math.min(x0, x1) - hw > win[2] || Math.max(y0, y1) + hw < win[1] || Math.min(y0, y1) - hw > win[3]);
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3];
    if (off(ax, ay, bx, by)) continue;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const nx = (-(by - ay) / len) * hw, ny = ((bx - ax) / len) * hw;
    out.push6(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny);
    out.push6(ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny);
  }
  if (hw < 0.75) return;
  const n = Math.max(6, Math.min(24, Math.ceil(hw * 3)));
  for (let k = 0; k < p.length; k += 2) {
    const x = p[k], y = p[k + 1];
    if (off(x, y, x, y)) continue;
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * 2 * Math.PI, a1 = ((j + 1) / n) * 2 * Math.PI;
      out.push6(x, y, x + Math.cos(a0) * hw, y + Math.sin(a0) * hw, x + Math.cos(a1) * hw, y + Math.sin(a1) * hw);
    }
  }
}
