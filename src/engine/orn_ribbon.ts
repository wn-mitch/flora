// Ribbon banners behind a title's lines, for the bouquet layout
// (frames.ts): each line sits on the face of a ribbon whose two ends fold
// back behind it into swallowtails, as on engraved title pages. The face
// is pale paper drawn round with a sepia hairline; the tails behind are
// darker and hatched, and a small fold joins each tail to the face. Boxes
// are page boxes, y up.
import { mod } from "#platform";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import type { Box } from "./layout.ts";
import type { Painter } from "./paint.ts";

const FACE: RGB = [0.985, 0.968, 0.925];
const BACK: RGB = [0.925, 0.885, 0.795];
const FOLD: RGB = [0.785, 0.715, 0.590];
const LINE: RGB = [0.330, 0.250, 0.165];

export interface RibbonShape {
  readonly face: Pt[];
  readonly tails: Pt[][];
  readonly folds: Pt[][];
  readonly box: [number, number, number, number];
}

// The ribbon behind one line box `l`, its tails dropping (dir -1) or rising
// (dir 1): closed point lists, and the box it all fills.
export function shape(l: Box, dir: number): RibbonShape {
  const lh = l.y1 - l.y0;
  const py = Math.max(4, lh * 0.38);
  const x0 = l.x0 - Math.max(8, lh * 0.7), x1 = l.x1 + Math.max(8, lh * 0.7), y0 = l.y0 - py, y1 = l.y1 + py;
  const h = y1 - y0;
  const d = dir * h * 0.42;
  const len = h * 1.15, notch = h * 0.38, f = h * 0.3;
  const out: RibbonShape = { face: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], tails: [], folds: [], box: [x0 - len, Math.min(y0, y0 + d), x1 + len, Math.max(y1, y1 + d)] };
  for (const s of [-1, 1]) {
    const e = s < 0 ? x0 : x1;
    const tip = e + s * len;
    out.tails.push([[e, y0 + d], [tip, y0 + d], [tip - s * notch, (y0 + y1) / 2 + d], [tip, y1 + d], [e, y1 + d]]);
    // The fold shows where the tail turns under the face: below the face
    // for a dropping tail, above it for a rising one.
    const edge = dir < 0 ? y0 : y1;
    out.folds.push([[e, edge], [e - s * f, edge], [e, edge + d]]);
  }
  return out;
}

// Hatching across polygon `poly`: parallel lines at angle `ang`, `gap`
// apart, clipped to the polygon.
function hatch(pt: Painter, poly: readonly Pt[], ang: number, gap: number, rgb: RGB, w: number, op: number): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const r = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2) / 2 + 1;
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const lines: Cmd[][] = [];
  for (let k = -r; k <= r; k += gap) {
    const mx = cx - uy * k, my = cy + ux * k;
    lines.push(G.polyline([[mx - ux * r, my - uy * r], [mx + ux * r, my + uy * r]], false));
  }
  pt.clipBegin(G.polyline(poly, true));
  pt.strokeMany(lines, rgb, w, op);
  pt.clipEnd();
}

// The bow's knot: a rounded band k wide about (x, y), a little taller than
// wide. Points, closed.
function knotShape(x: number, y: number, k: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (2 * Math.PI * i) / 16;
    out.push([x + k * Math.cos(a), y + k * 1.35 * Math.sin(a) + k * 0.2]);
  }
  return out;
}

// A bow of the same ribbon tied round a bouquet's stems at (x, y), s
// across: two loops tilted up from the knot, each a teardrop pinched at
// the knot with its shaded opening near the outer end, two tails falling
// from the knot, and the knot.
export function bow(pt: Painter, x: number, y: number, s: number): void {
  const loops: Pt[][] = [], holes: Pt[][] = [], tails: Pt[][] = [];
  const L = s * 0.56;
  const c = Math.cos(0.38), sn = Math.sin(0.38);
  for (const d of [-1, 1]) {
    // Local (u along the loop, v across it), tilted up and mirrored for
    // the left loop.
    const at = (u: number, v: number): Pt => [x + d * (u * c - v * sn), y + u * sn + v * c];
    const loop: Pt[] = [], hole: Pt[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (2 * Math.PI * i) / 32;
      const u = L * 0.5 * (1 - Math.cos(a));
      loop.push(at(u, L * 0.3 * Math.sin(a) * G.smoothstep(0, L * 0.4, u)));
      hole.push(at(L * 0.66 + L * 0.2 * Math.cos(a), L * 0.1 * Math.sin(a)));
    }
    loops.push(loop);
    holes.push(hole);
    const tip: Pt = [x + d * s * 0.42, y - s * 0.95];
    tails.push([
      [x - d * s * 0.04, y - s * 0.02], [x + d * s * 0.12, y - s * 0.04],
      [tip[0] + d * s * 0.08, tip[1] + s * 0.02], [tip[0] - d * s * 0.02, tip[1] + s * 0.12],
      [tip[0] - d * s * 0.12, tip[1] - s * 0.02],
    ]);
  }
  for (const t of tails) {
    pt.fill(G.polyline(t, true), BACK, 1);
    hatch(pt, t, -1.2, 1.4, LINE, 0.2, 0.5);
    pt.stroke(G.polyline(t, true), LINE, 0.4, 0.9);
  }
  for (let i = 0; i < loops.length; i++) {
    const lc = G.smooth(loops[i], true);
    pt.fill(lc, FACE, 1);
    pt.stroke(lc, LINE, 0.45, 0.9);
    // The loop's opening: the ribbon's inside, darker and hatched.
    const h = G.smooth(holes[i], true);
    pt.fill(h, BACK, 1);
    hatch(pt, holes[i], 0.6, 1.2, LINE, 0.18, 0.5);
    pt.stroke(h, LINE, 0.35, 0.9);
  }
  const k = s * 0.09;
  const knot = G.smooth(knotShape(x, y, k), true);
  pt.fill(knot, BACK, 1);
  hatch(pt, knotShape(x, y, k), 1.57, 1.3, LINE, 0.18, 0.45);
  pt.stroke(knot, LINE, 0.45, 0.9);
}

// Paint a ribbon behind each of `lines` (page boxes), alternating the
// tails' direction from line to line, the first dropping.
export function paint(pt: Painter, lines: readonly Box[]): void {
  for (let i = 0; i < lines.length; i++) {
    const r = shape(lines[i], mod(i, 2) === 0 ? -1 : 1);
    for (const t of r.tails) {
      pt.fill(G.polyline(t, true), BACK, 1);
      hatch(pt, t, 0, 1.5, LINE, 0.22, 0.55);
    }
    for (const f of r.folds) pt.fill(G.polyline(f, true), FOLD, 1);
    const outline: Cmd[][] = [];
    for (const t of r.tails) outline.push(G.polyline(t, true));
    for (const f of r.folds) outline.push(G.polyline(f, true));
    pt.strokeMany(outline, LINE, 0.45, 0.9);
    pt.fill(G.polyline(r.face, true), FACE, 1);
    // The face's edges, drawn twice like an engraver's border rule.
    const f = r.face;
    const inset = [
      G.polyline([[f[0][0] + 1.5, f[0][1] + 1.6], [f[1][0] - 1.5, f[1][1] + 1.6]], false),
      G.polyline([[f[3][0] + 1.5, f[3][1] - 1.6], [f[2][0] - 1.5, f[2][1] - 1.6]], false),
    ];
    pt.stroke(G.polyline(f, true), LINE, 0.5, 0.95);
    pt.strokeMany(inset, LINE, 0.22, 0.6);
  }
}
