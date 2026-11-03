// Gold in relief, shaded by which way its surface faces. Metal shows no
// colour of its own, only what it mirrors, so a shape reads as gold when
// its brightness follows its form: each shape is given a rounded bevel of
// a few rings just inside its edge, each short piece of ring tilted out
// toward the edge it runs along, and every piece takes the colour of what
// it would mirror from a studio lit from the page's upper left: bright sky
// on the lit side, a sharp bright horizon, dark ground below it and a warm
// bounce at the far side. The flat top mirrors the viewer and stays a mid
// gold. Thin shapes are all bevel, so a stroke reads as round wire.
//
// Everything is worked in page coordinates (after the painter's frame and
// projection), so light falls the same way on a mirrored corner, and is
// painted as plain fills grouped by colour level: vector, at any zoom.
import { mod } from "#platform";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import type { Painter, Projection } from "./paint.ts";

const PI = Math.PI;
const LEVELS = 28;          // colour levels the bevel pieces are grouped into
const TILT = 1.32;          // tilt of the outermost ring, radians (~75 degrees)
const LX = -0.6, LY = 0.8;  // the light's side of the page, a unit vector

// Gold by mirrored brightness v (0-1), dark to white-hot.
const RAMP: readonly (readonly [number, RGB])[] = [
  [0.00, [0.240, 0.130, 0.050]],
  [0.20, [0.420, 0.270, 0.100]],
  [0.45, [0.680, 0.500, 0.220]],
  [0.62, [0.840, 0.670, 0.330]],
  [0.80, [0.950, 0.840, 0.520]],
  [1.00, [1.000, 0.970, 0.840]],
];

export type Tone = "shade" | undefined;

// Gold of mirrored brightness v; the shaded tone (copper faces) is redder
// and a step darker.
export function color(v: number, tone?: Tone): RGB {
  v = G.clamp(v, 0, 1);
  let c: RGB = RAMP[RAMP.length - 1][1];
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const a = RAMP[i - 1], b = RAMP[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      c = [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t];
      break;
    }
  }
  if (tone === "shade") c = [c[0] * 0.9, c[1] * 0.68, c[2] * 0.6];
  return c;
}

// What a surface whose outward edge faces (nx, ny) on the page, tilted
// `th` from facing the viewer, mirrors: brightness 0-1.
export function mirror(nx: number, ny: number, th: number): number {
  const st = Math.sin(th), ct = Math.cos(th);
  // The viewer's line of sight (0, 0, 1) reflected about the normal.
  const rx = 2 * ct * st * nx, ry = 2 * ct * st * ny;
  const u = rx * LX + ry * LY;
  let v = 0.14 + 0.22 * G.smoothstep(-0.3, -1, u);
  v = v + (0.8 + 0.2 * G.smoothstep(0.25, 0.95, u) - v) * G.smoothstep(-0.02, 0.06, u);
  v = v + 0.22 * Math.exp(-(((u - 0.08) / 0.05) ** 2));
  const front = 0.52;
  return front + (v - front) * G.smoothstep(0.05, 0.6, Math.sqrt(rx * rx + ry * ry));
}

// Closed polygons (page coordinates) for paint commands `cmds`, through
// map `pj`. Curves and circles are sampled about every 0.9 pt, and points
// closer than 0.45 pt to the last kept one are skipped. Subpaths of fewer
// than `least` points are dropped.
export function flatten(cmds: readonly Cmd[], pj?: Projection, least = 3): Pt[][] {
  const polys: Pt[][] = [];
  let cur: Pt[] | undefined;
  const put = (x: number, y: number) => {
    if (cur === undefined) return;
    if (pj !== undefined) [x, y] = pj(x, y);
    const last = cur.length > 0 ? cur[cur.length - 1] : undefined;
    if (last === undefined || Math.abs(last[0] - x) + Math.abs(last[1] - y) > 0.45) cur.push([x, y]);
  };
  const finish = () => {
    if (cur !== undefined && cur.length >= least) polys.push(cur);
    cur = undefined;
  };
  let px = 0, py = 0;
  for (const c of cmds) {
    if (c[0] === "m") {
      finish();
      cur = [];
      put(c[1], c[2]);
      px = c[1];
      py = c[2];
    } else if (c[0] === "l") {
      put(c[1], c[2]);
      px = c[1];
      py = c[2];
    } else if (c[0] === "c") {
      const len = G.dist([px, py], [c[1], c[2]]) + G.dist([c[1], c[2]], [c[3], c[4]]) + G.dist([c[3], c[4]], [c[5], c[6]]);
      const n = G.clamp(Math.ceil(len / 0.9), 1, 24);
      const pts = G.bezier([px, py], [c[1], c[2]], [c[3], c[4]], [c[5], c[6]], n);
      for (let i = 1; i < pts.length; i++) put(pts[i][0], pts[i][1]);
      px = c[5];
      py = c[6];
    } else if (c[0] === "o") {
      finish();
      cur = [];
      const n = G.clamp(Math.ceil((2 * PI * c[3]) / 0.9), 8, 48);
      for (let k = 0; k < n; k++) put(c[1] + c[3] * Math.cos((2 * PI * k) / n), c[2] + c[3] * Math.sin((2 * PI * k) / n));
      finish();
    } else {
      finish();
    }
  }
  finish();
  // A closing point repeating the first adds nothing.
  for (const p of polys) {
    if (p.length > 3 && Math.abs(p[0][0] - p[p.length - 1][0]) + Math.abs(p[0][1] - p[p.length - 1][1]) < 0.45) p.pop();
  }
  return polys;
}

export function area(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], r = p[mod(i + 1, p.length)];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
}

// The bevel of polygon `p` (page coordinates) as strips sorted into colour
// levels `buckets` (level -> strips). Returns the polygon's inner top, or
// undefined when the shape is too small to bevel.
export function bevel(p: readonly Pt[], buckets: Pt[][][], depthCap = 4, tilt = TILT): Pt[] | undefined {
  const n = p.length;
  const A = area(p);
  let per = 0;
  for (let i = 0; i < n; i++) per += G.dist(p[i], p[mod(i + 1, n)]);
  if (Math.abs(A) < 0.01 || per < 0.1) return undefined;
  const s = A > 0 ? 1 : -1;
  // Thickness: twice the area over the perimeter, a ribbon's width.
  const T = (2 * Math.abs(A)) / per;
  const depth = Math.min(0.45 * T, 0.5 + 0.16 * T, depthCap);
  const rings = G.clamp(Math.ceil(depth / 0.35), 2, 5);
  // Outward normal of each edge, and each vertex's mitred offset.
  const en: Pt[] = [], off: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[mod(i + 1, n)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.sqrt(dx * dx + dy * dy);
    en.push(l > 0 ? [(s * dy) / l, (-s * dx) / l] : [0, 0]);
  }
  for (let i = 0; i < n; i++) {
    const n1 = en[mod(i - 1, n)], n2 = en[i];
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    let l = Math.sqrt(mx * mx + my * my);
    if (l < 1e-6) {
      mx = n2[0];
      my = n2[1];
      l = 1;
    }
    mx /= l;
    my /= l;
    const k = 1 / Math.max(0.4, mx * n2[0] + my * n2[1]);
    off.push([mx * k, my * k]);
  }
  const ring = (d: number): Pt[] => p.map((q, i): Pt => [q[0] - off[i][0] * d, q[1] - off[i][1] * d]);
  let outer: readonly Pt[] = p;
  for (let r = 1; r <= rings; r++) {
    const inner = ring((depth * r) / rings);
    const th = tilt * (1 - (r - 0.5) / rings) ** 1.4;
    // Runs of edges at one colour level become one strip: the outer ring's
    // run forward, the inner ring's back.
    const level = en.map((e) => Math.floor(G.clamp(mirror(e[0], e[1], th), 0, 1) * (LEVELS - 1) + 0.5));
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n - 1 && level[j + 1] === level[i]) j++;
      let strip: Pt[] = [];
      for (let k = i; k <= j + 1; k++) strip.push(outer[mod(k, n)]);
      for (let k = j + 1; k >= i; k--) strip.push(inner[mod(k, n)]);
      // One winding for every strip, so overlaps never cancel.
      if (area(strip) < 0) strip = strip.slice().reverse();
      buckets[level[i]].push(strip);
      i = j + 1;
    }
    outer = inner;
  }
  return outer.slice();
}

export interface ReliefOptions {
  readonly tone?: Tone;
  readonly shadow?: number; // drop-shadow offset, pt (0 for none)
  readonly key?: number;    // keyline width, pt (0 for none)
  readonly depth?: number;  // the deepest bevel, pt (4)
  readonly tilt?: number;   // the outermost ring's tilt, radians
}

const SHADOW: RGB = [0.45, 0.28, 0.14];
const KEYLINE: RGB = [0.30, 0.18, 0.07];

// Paint closed polygons `polys`, in page coordinates, as gold in relief.
export function paintPolys(pt: Painter, polys: readonly Pt[][], o: ReliefOptions = {}): void {
  if (polys.length === 0) return;
  pt.inPage(() => {
    const all = polys.map((poly) => G.polyline(poly, true));
    const shadow = o.shadow ?? 0;
    if (shadow > 0) pt.fillMany(polys.map((poly) => G.polyline(poly.map((v): Pt => [v[0] - LX * shadow, v[1] - LY * shadow]), true)), SHADOW, 0.35);
    // The top mirrors the room straight ahead: a soft sheen, brightest a
    // little toward the light, a darker band past the middle and a lift at
    // the far side, under everything.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) {
      for (const v of poly) {
        x0 = Math.min(x0, v[0]);
        y0 = Math.min(y0, v[1]);
        x1 = Math.max(x1, v[0]);
        y1 = Math.max(y1, v[1]);
      }
    }
    const stops: [number, RGB][] = [[0, color(0.62, o.tone)], [0.3, color(0.7, o.tone)], [0.62, color(0.42, o.tone)], [0.85, color(0.5, o.tone)], [1, color(0.46, o.tone)]];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const half = (Math.abs(LX) * (x1 - x0) + Math.abs(LY) * (y1 - y0)) / 2 + 0.5;
    const clip: Cmd[] = [];
    for (const cmds of all) for (const c of cmds) clip.push(c);
    pt.clipBegin(clip);
    pt.shade(stops, [cx + LX * half, cy + LY * half], [cx - LX * half, cy - LY * half], x1 - x0 + (y1 - y0) + 2);
    pt.clipEnd();
    const buckets: Pt[][][] = [];
    for (let q = 0; q < LEVELS; q++) buckets.push([]);
    for (const poly of polys) bevel(poly, buckets, o.depth, o.tilt);
    for (let q = 0; q < LEVELS; q++) {
      if (buckets[q].length > 0) pt.fillMany(buckets[q].map((strip) => G.polyline(strip, true)), color(q / (LEVELS - 1), o.tone), 1);
    }
    const key = o.key ?? 0.14;
    if (key > 0) pt.strokeMany(all, KEYLINE, key, 0.7);
  });
}

// Paint `paths` (in pt's own coordinates) as gold in relief.
export function paint(pt: Painter, paths: readonly (readonly Cmd[])[], o: ReliefOptions = {}): void {
  const pj = pt.map();
  const polys: Pt[][] = [];
  for (const cmds of paths) for (const poly of flatten(cmds, pj)) polys.push(poly);
  paintPolys(pt, polys, o);
}

// Ribbon outlines `w` wide along each path of `paths` (open or closed), as
// closed polygons in page coordinates, for gilding a stroke.
export function ribbons(pt: Painter, paths: readonly (readonly Cmd[])[], w: number): Pt[][] {
  const pj = pt.map();
  const out: Pt[][] = [];
  for (const cmds of paths) {
    // Flatten without closing, then close loops by repeating the start.
    const closed = cmds.some((c) => c[0] === "z" || c[0] === "o");
    for (const poly of flatten(cmds, undefined, 2)) {
      if (closed) poly.push(poly[0]);
      if (poly.length >= 2) {
        let rib = G.ribbon(poly, () => w / 2);
        if (pj !== undefined) rib = rib.map((v) => pj(v[0], v[1]));
        out.push(rib);
      }
    }
  }
  return out;
}
