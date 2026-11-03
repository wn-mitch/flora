// Shared shapes for the ornament kinds: gilt fills, rays, crescents,
// scrolls and fleurons. Shapes return paths or point lists; painting stays
// with the kinds. Angles are radians, y points up.
import { mod } from "#platform";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Box, SlotOptions } from "./orn_registry.ts";

const PI = Math.PI;

export const GOLD = PAL.gold, COPPER = PAL.copper, CREAM = PAL.cream, WHITE = PAL.white;

// Centre, width, height and smaller side of box b.
export function measure(b: Box): [number, number, number, number, number] {
  const w = b[2] - b[0], h = b[3] - b[1];
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, w, h, Math.min(w, h)];
}

export function dot(x: number, y: number, r: number): Cmd[] {
  return [["o", x, y, r]];
}

// n dots of radius r on a circle of radius R about (x, y), from angle a0.
export function ring(x: number, y: number, R: number, n: number, r: number, a0 = PI / 2): Cmd[][] {
  const out: Cmd[][] = [];
  for (let k = 0; k < n; k++) {
    const p = G.polar([x, y], a0 + (k * 2 * PI) / n, R);
    out.push(dot(p[0], p[1], r));
  }
  return out;
}

// Points of an ellipse about (x, y), turned by `rot`.
export function ellipse(x: number, y: number, rx: number, ry: number, rot = 0, n = 32): Pt[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k * 2 * PI) / n;
    const u = rx * Math.cos(a), v = ry * Math.sin(a);
    out.push([x + u * c - v * s, y + u * s + v * c]);
  }
  return out;
}

// An n-pointed star polygon, outer radius R and inner r.
export function star(x: number, y: number, R: number, r: number, n: number, rot = PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < 2 * n; k++) out.push(G.polar([x, y], rot + (k * PI) / n, mod(k, 2) === 0 ? R : r));
  return out;
}

export interface RayOptions {
  readonly rot?: number;
  readonly short?: number;  // the short rays' reach, share of r1 - r0
  readonly width?: number;  // a ray's half-width, share of its sector
  readonly flames?: boolean; // every other ray a wavy flame
}

// Rays round (x, y) from radius r0 to r1, each split into a lit and a
// shaded half as the compass's are. Every other ray is a flame (wavy) when
// `flames` is set, as in a sun in splendour. Returns lit and shade paths.
export function rays(x: number, y: number, r0: number, r1: number, n: number, o: RayOptions = {}): [Cmd[][], Cmd[][]] {
  const lit: Cmd[][] = [], shade: Cmd[][] = [];
  for (let k = 0; k < n; k++) {
    const a = (o.rot ?? PI / 2) + (k * 2 * PI) / n;
    const long = mod(k, 2) === 0;
    const len = long ? r1 : r0 + (r1 - r0) * (o.short ?? 0.62);
    const half = (((o.width ?? 0.18) * 2 * PI) / n) * r0;
    const base = G.polar([x, y], a, r0);
    const tip = G.polar([x, y], a, len);
    const l = G.polar(base, a + PI / 2, half), r = G.polar(base, a - PI / 2, half);
    if (o.flames === true && !long) {
      // A flame: the ray's spine waves twice on its way out.
      const left: Pt[] = [], right: Pt[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const p = G.polar(G.polar([x, y], a, r0 + (len - r0) * t), a + PI / 2, half * 0.7 * Math.sin(t * 2 * PI) * (1 - t));
        const w = half * (1 - i / 8);
        left.push(G.polar(p, a + PI / 2, w));
        right.push(G.polar(p, a - PI / 2, w));
      }
      const poly = left.slice();
      for (let i = right.length - 1; i >= 0; i--) poly.push(right[i]);
      lit.push(G.smooth(poly, true));
    } else {
      lit.push(G.polyline([base, tip, l], true));
      shade.push(G.polyline([base, tip, r], true));
    }
  }
  return [lit, shade];
}

// Paint gilt: shaded halves in copper under lit ones in gold.
export function gilt(pt: Painter, lit: readonly Cmd[][] | undefined, shade: readonly Cmd[][] | undefined, opacity = 0.95): void {
  if (shade !== undefined && shade.length > 0) pt.fillMany(shade, PAL.copper, opacity);
  if (lit !== undefined && lit.length > 0) pt.fillMany(lit, PAL.gold, opacity);
}

// A crescent of radius r about (x, y): the circle less a second one
// shifted by `bite` (share of r) toward angle `rot`. Points, closed.
export function crescent(x: number, y: number, r: number, bite: number, rot: number): Pt[] {
  const out: Pt[] = [];
  const d = r * bite;
  // The two circles meet where |p| = r and |p - d e| = r: at angle
  // acos(d / 2r) either side of the bite's direction.
  const m = Math.acos(G.clamp(d / (2 * r), -1, 1));
  const n = 24;
  for (let k = 0; k <= n; k++) out.push(G.polar([x, y], rot + m + ((2 * PI - 2 * m) * k) / n, r));
  // Back along the second circle's arc inside the first.
  const c2: Pt = [x + d * Math.cos(rot), y + d * Math.sin(rot)];
  for (let k = 1; k < n; k++) out.push(G.polar(c2, rot + PI + m - (2 * m * k) / n, r));
  return out;
}

// A C-scroll: a spiral from `p` heading `ang`, of size s, curling to the
// left (dir 1) or right (dir -1) for `turns` turns. Points.
export function scroll(p: Pt, ang: number, s: number, dir: number, turns = 1.15): Pt[] {
  const out: Pt[] = [];
  const n = 28;
  let x = p[0], y = p[1], a = ang;
  for (let i = 0; i <= n; i++) {
    out.push([x, y]);
    const t = i / n;
    const step = s * 0.11 * (1 - 0.82 * t);
    a += ((dir * turns * 2 * PI) / n) * (0.55 + 0.9 * t);
    x += step * Math.cos(a);
    y += step * Math.sin(a);
  }
  return out;
}

// A tapered ribbon along `pts`, w wide at its start, as a filled path.
export function taper(pts: readonly Pt[], w: number, tail = 0.15): Cmd[] {
  return G.smooth(G.ribbon(pts, (t) => (w * (1 - (1 - tail) * t)) / 2), true);
}

// A heart-shaped leaf (a hedera, the printers' fleuron) of size s: the
// notch at the stalk sits at (x, y) and the tip lies s away toward `ang`,
// narrowed by `wide`. Points, closed.
export function leaf(x: number, y: number, s: number, ang: number, wide = 1): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k < 40; k++) {
    const t = (k * 2 * PI) / 40;
    const hx = 16 * Math.sin(t) ** 3;
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([(hx / 22) * 0.9, (5 - hy) / 22]);
  }
  return G.transform(pts, x, y, ang - PI / 2, s * wide, s);
}

// A pointed lozenge (a fleuron's petal) of length s from (x, y) toward
// `ang`, widest just behind its middle. Points, closed.
export function lozenge(x: number, y: number, s: number, ang: number): Pt[] {
  const right: Pt[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    right.push([0.34 * Math.sin(PI * t) ** 1.3 * (1 - 0.25 * t), t]);
  }
  const pts = right.slice();
  for (let k = right.length - 2; k >= 1; k--) pts.push([-right[k][0], right[k][1]]);
  return G.transform(pts, x, y, ang - PI / 2, s, s);
}

// Three round lobes (a trefoil) of size s, pointing `ang`. Paths.
export function trefoil(x: number, y: number, s: number, ang: number): Cmd[][] {
  const out: Cmd[][] = [];
  for (let k = -1; k <= 1; k++) {
    const p = G.polar([x, y], ang + (k * 2 * PI) / 3, s * 0.42);
    out.push(dot(p[0], p[1], s * 0.36));
  }
  return out;
}

// A gilt armillary sphere of radius r about (x, y): the outer ring, a
// tilted equator and ecliptic, a meridian, the axis and a small sun at the
// centre, standing on a short stem whose foot is no lower than `floor`.
export function armillary(pt: Painter, x: number, y: number, r: number, tilt: number, floor = -Infinity): void {
  const rings = [
    G.smooth(ellipse(x, y, r, r, 0, 40), true),
    G.smooth(ellipse(x, y, r, r * 0.3, -tilt, 40), true),
    G.smooth(ellipse(x, y, r * 0.32, r, 0, 40), true),
    G.smooth(ellipse(x, y, r, r * 0.24, tilt * 0.6, 40), true),
  ];
  const w = Math.max(0.3, r * 0.025);
  pt.strokeMany(rings, PAL.copper, w * 1.7, 0.55);
  pt.strokeMany(rings, PAL.gold, w, 0.95);
  pt.stroke(G.smooth(ellipse(x, y, r * 0.93, r * 0.22, -tilt, 40), true), PAL.gold, w * 0.55, 0.7);
  const a = PI / 2 - tilt * 0.6;
  pt.stroke(G.polyline([G.polar([x, y], a, r * 1.22), G.polar([x, y], a + PI, r * 1.22)], false), PAL.copper, w * 0.9, 0.9);
  pt.fill(dot(x, y, r * 0.13), PAL.gold, 0.95);
  pt.fill(dot(x - r * 0.03, y + r * 0.03, r * 0.06), PAL.cream, 0.9);
  const foot = Math.max(floor, y - r * 1.45);
  pt.stroke(G.polyline([[x, y - r], [x, foot]], false), PAL.gold, w * 1.2, 0.9);
  pt.fill(G.smooth(ellipse(x, foot, r * 0.42, r * 0.09, 0, 20), true), PAL.gold, 0.9);
}

// Run draw(x0, y0, s) for the lower-left corner of box b, mirrored into
// another corner by o.flip = [fx, fy] (each 1 or -1).
export function corner(pt: Painter, b: Box, o: SlotOptions, draw: (x0: number, y0: number, s: number) => void): void {
  const [cx, cy, , , s] = measure(b);
  const fx = o.flip?.[0] ?? 1, fy = o.flip?.[1] ?? 1;
  const base = pt.currentFrame;
  pt.frame((x, y) => {
    const q: Pt = [cx + fx * (x - cx), cy + fy * (y - cy)];
    return base === undefined ? q : base(q[0], q[1]);
  });
  draw(cx - s / 2, cy - s / 2, s);
  pt.frame(base);
}
