// Page planning: the growing region, the vine's strands and runners. The
// compose pass runs these in order:
//   1. region: the margin column, the foot band and the outer foot corner
//      are opened; text lines are blocked (short and indented lines leave
//      room);
//   2. strands: the line of action (gesture) is laid out, then the plant
//      grows: its main stem from the root at the foot's right end along the
//      gesture to the hero, and long shoots that climb with it (plant.ts);
//   3. features, ornaments and fill follow in compose.
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import * as P from "./plant.ts";
import type { Bow, Gesture, Hero, Rect, Region, Stem } from "./plant.ts";
import type { Rng } from "./rng.ts";
import { tendril } from "./sprig.ts";
import { Space } from "./space.ts";
import { GESTURE } from "./tune.ts";

const PI = Math.PI;

// A measured box on the page, pt, y up.
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

// What a page offers the flora: its size, the text block and, optionally,
// its measured lines and header.
export interface PageSpec {
  readonly width: number;
  readonly height: number;
  readonly text: Box;
  readonly edge?: number;          // paper left bare at the edges, pt (16)
  readonly gutter?: number;        // between the margin and the text, pt (9)
  readonly bare?: boolean;         // Region.bare
  readonly gather?: number;        // Region.gather
  readonly lines?: readonly Box[]; // measured content boxes
  readonly frame_only?: boolean;   // a layout that only frames the text
  readonly header_y?: number;      // the running head's baseline
  readonly closed?: readonly Rect[]; // rectangles another plant owns
}

// A stem without forks: its points and its full width at fraction t.
export interface Strand {
  readonly pts: Pt[];
  readonly width: (this: void, t: number) => number;
}

// Open the growing region and block text. Without `spec.lines` the whole
// text block is blocked.
export function region(spec: PageSpec): [Space, Region] {
  const W = spec.width, H = spec.height, t = spec.text;
  const g = new Space(W, H, 3);
  const edge = spec.edge ?? 16;
  const gutter = spec.gutter ?? 9;
  const m: Region = {
    x0: edge, x1: t.x0 - gutter,
    y0: edge + 4, y1: H - edge - 6,
    foot: t.y0 - gutter * 0.8,
    bare: spec.bare, gather: spec.gather,
  };
  g.open(m.x0, m.y0, m.x1, m.y1);
  g.open(m.x0, m.y0, W - edge, m.foot);
  g.open(t.x1 + 5, m.y0, W - edge * 0.6, t.y0 + (t.y1 - t.y0) * 0.22);
  if (spec.lines !== undefined && spec.lines.length > 0) {
    // Room the text leaves inside its block is opened, except for layouts
    // that only frame the text.
    if (spec.frame_only !== true) openShortLines(g, spec, gutter);
    for (const l of spec.lines) g.blockText(l.x0 - 4, l.y0 - 3, l.x1 + 4, l.y1 + 3);
  }
  if (spec.header_y !== undefined) g.blockText(t.x0 - 4, spec.header_y - 4, t.x1, spec.header_y + 12);
  for (const r of spec.closed ?? []) g.close(r[0], r[1], r[2], r[3]);
  return [g, m];
}

// A vertical gap between lines at least this tall (pt) is a clearing: room
// left for a figure, a break between sections or a \vspace.
export const CLEARING = 40;

// Inside the text block, open the space left of each line's first ink, and
// the empty stretch below the last line. Gaps between lines inherit the
// narrower of their neighbours so flora does not fill paragraph breaks, but
// a clearing (CLEARING) opens across the whole width, kept 10 pt from the
// lines around it, so the flora grows into it.
export function openShortLines(g: Space, spec: PageSpec, gutter: number): void {
  const t = spec.text, pad = 5;
  const lines = (spec.lines ?? []).filter((l) => l.x1 > l.x0 && l.y1 > t.y0 - 2);
  if (lines.length === 0) return;
  G.sortBy(lines, (l) => -l.y1);
  const lowest = lines[lines.length - 1].y0;
  const cap = t.x0 + (t.x1 - t.x0) * 0.42;
  for (let y = t.y0; y <= t.y1; y += g.c) {
    let reach: number | undefined;
    if (y < lowest - 14) {
      reach = t.x1;
    } else {
      for (const l of lines) {
        if (y + g.c > l.y0 - 1 && y < l.y1 + 1) reach = Math.min(reach ?? Infinity, l.x0);
      }
      if (reach === undefined) {
        let above: Box | undefined, below: Box | undefined;
        for (const l of lines) {
          if (l.y0 >= y && (above === undefined || l.y0 < above.y0)) above = l;
          if (l.y1 <= y && (below === undefined || l.y1 > below.y1)) below = l;
        }
        if (above !== undefined && below !== undefined && above.y0 - below.y1 >= CLEARING && above.y0 - y >= 10 && y + g.c - below.y1 >= 10) {
          reach = t.x1 + pad;
        } else {
          reach = Math.min(above?.x0 ?? t.x0, below?.x0 ?? t.x0, cap);
        }
      } else {
        reach = Math.min(reach, cap);
      }
    }
    if (reach - pad > t.x0 - gutter) g.open(t.x0 - gutter, y, reach - pad, y + g.c);
  }
}

// The star cartouche's width and height for margin width mw, scaled by k:
// the reference's panel, about 40 x 54 pt over its frame, in a margin
// about 148 pt wide.
export function cartoucheSize(mw: number, k = 1): [number, number] {
  return [G.clamp(mw * 0.27 * k, 16, 48), G.clamp(mw * 0.365 * k, 22, 66)];
}

// The border's line of action. Strands hug the outer margin at `edge` and
// bow inward toward the text two or three times; each bow is a
// raised-cosine window, so the heading stays continuous. Bows are where
// the border gathers: `density` peaks there, at the hero bloom and at the
// foot corner, and falls to a floor in the quiet stretches between, where
// the stems run nearly bare. `quiet` lists the heights midway between bows.
export function gesture(rng: Rng, m: Region, hero: Hero): Gesture {
  const cfg = GESTURE;
  const mw = m.x1 - m.x0;
  const lo = m.y0 + mw * 0.75 + 40;
  const hi = hero[1] - hero[2] * 1.2;
  const n = cfg.bows;
  const band = (hi - lo) / n;
  const bows: Bow[] = [], quiet: number[] = [];
  for (let i = 0; i < n; i++) {
    bows.push({
      y: lo + band * (i + 0.5 + rng.jit(0.18)),
      amp: mw * rng.range(cfg.bow_amp[0], cfg.bow_amp[1]),
      h: band * rng.range(cfg.bow_width[0], cfg.bow_width[1]),
    });
    if (i > 0) quiet.push((bows[i - 1].y + bows[i].y) / 2);
  }
  const edge = m.x0 + mw * cfg.edge;
  // Clusters [x, y, radius, peak]: the border is densest around the hero
  // and along the foot, as the reference's is, and swells more gently at
  // each bow (GESTURE.bow_density).
  const clusters: [number, number, number, number][] = [
    [hero[0], hero[1], hero[2] * cfg.end_reach, 1],
    [m.x0 + mw * 0.6, m.y0 + 30, (110 * cfg.end_reach) / 2.2, 1],
    [m.x0 + mw * 0.35, m.y0 + mw * 0.9, mw * 0.6, 1],
  ];
  // Clusters stay tighter than the bows, so the stretches between them
  // read as quiet even where wide bows overlap.
  for (const b of bows) clusters.push([edge + b.amp * 0.7, b.y, band * 0.32, cfg.bow_density]);
  const floor = cfg.density_floor;
  return {
    edge, bows, quiet,
    bow: (y, dy = 0, gain) => {
      let x = 0;
      for (let i = 0; i < bows.length; i++) {
        const b = bows[i];
        const u = (y - b.y - dy) / b.h;
        if (Math.abs(u) < 1) x += b.amp * (gain?.[i] ?? 1) * 0.5 * (1 + Math.cos(PI * u));
      }
      return x;
    },
    density: (x, y) => {
      let best = 0;
      for (const c of clusters) {
        const dx = (x - c[0]) / c[2], dy = (y - c[1]) / c[2];
        best = Math.max(best, c[3] * Math.exp(-(dx * dx + dy * dy)));
      }
      return floor + (1 - floor) * best;
    },
  };
}

// The plant's stems (plant.ts): the main stem first, then the long shoots,
// then the shoots fanning from the foot and corner, then the hero's crown.
// Returns them, the corner point where the main stem starts to rise, and
// the gesture. Stems bend around rectangle `avoid`, kept for the cartouche.
export function strands(rng: Rng, m: Region, hero: Hero, W: number, gest?: Gesture, avoid?: Rect): [Stem[], Pt, Gesture] {
  const g = gest ?? gesture(rng.fork("gesture"), m, hero);
  const [mainStem, corner] = P.main(rng.fork("main"), m, hero, W, g, avoid);
  const out: Stem[] = [mainStem];
  for (const st of P.longShoots(rng.fork("shoots"), mainStem, m, hero, g, avoid)) out.push(st);
  // A gathered plant's foot is the bouquet's bare, tied stems.
  if (m.gather === undefined) for (const st of P.footShoots(rng.fork("foot shoots"), mainStem, m, corner, avoid)) out.push(st);
  for (const st of P.crown(rng.fork("crown"), mainStem, m, hero)) out.push(st);
  return [out, corner, g];
}

// The outer-corner sprig: a shoot that leaves the plant's root, sweeps up
// the outer edge and ends in a volute. With grid g, a sprig that would
// cross text (as by the middle of a flank page, where the frame's outer
// corner is) is left out.
export function runners(m: Region, root: Pt, W: number, edge: number, g?: Space): Strand[] {
  const cx = W - edge - 6;
  const b: Pt = [cx, m.y0 + 70];
  const pts = G.link(root, 0.05, b, PI / 2 + 0.08, 0.6);
  const tip = tendril(b, PI / 2 + 0.08, 46, 1);
  for (let i = 1; i < tip.length; i++) pts.push(tip[i]);
  if (g !== undefined) {
    for (const q of pts) if (g.textAt(q[0], q[1]) || g.textAt(q[0] - 2, q[1]) || g.textAt(q[0] + 2, q[1])) return [];
  }
  return [{ pts, width: (t) => 0.8 - 0.6 * t }];
}

// When the text stops well short of the foot, a strand leaves the root and
// wanders up into the empty part of the text block. Undefined otherwise.
export function excursion(rng: Rng, spec: PageSpec, root: Pt): Strand | undefined {
  const t = spec.text;
  if (spec.lines === undefined) return undefined;
  let lowest = t.y1;
  for (const l of spec.lines) {
    if (l.x1 > t.x0 && l.x0 < t.x1 && l.y0 > t.y0 - 2 && l.y1 < t.y1 + 2) lowest = Math.min(lowest, l.y0);
  }
  const room = lowest - t.y0;
  if (room < 140) return undefined;
  const w = t.x1 - t.x0;
  const ceiling = lowest - 30;
  const pts: Pt[] = [root, [root[0] + 22, root[1] + 4], [t.x0 - 4, root[1] + rng.range(18, 30)]];
  const n = 5;
  const phase = rng.range(0, 2 * PI);
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const x = t.x0 + w * (0.08 + 0.78 * u);
    const y = t.y0 + room * (0.18 + 0.55 * u) + room * 0.10 * Math.sin(phase + u * 5);
    pts.push([x, Math.min(y, ceiling)]);
  }
  return { pts: G.splinePoints(pts, 6), width: (t2) => 1.3 - 0.9 * t2 };
}
