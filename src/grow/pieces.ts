// What a growing garden paints (garden.ts): each piece is one component's
// painting, a stem's stretch, a leaf, a spray, a bloom or a gilt sparkle,
// painted by the engine's own brushes on a painter of its own, with the
// timeline of how it is laid down. A piece starts at a tick of the
// garden's clock and is laid down over its own time from there; once laid
// down it is finished and never changes.
import { brush as B, flower as F, leaf as L, ornament as O, sprig as S, tune, Painter, PAL, Rng, type Lay } from "../engine/index.ts";
import { mix as mixInk, type RGB } from "../engine/color.ts";
import type { Pt } from "../engine/geom.ts";
import * as G from "../engine/geom.ts";
import type { DisplayList, Item } from "../display.ts";
import { pathBox } from "../flatten.ts";
import { Timeline } from "../timeline.ts";

// [x0, y0, x1, y1] in the scene's coordinates (y down from the top).
export type Box = readonly [number, number, number, number];

export interface Piece {
  readonly id: number;
  readonly kind: string;
  // The tick it starts at, and its own growth per tick.
  readonly start: number;
  readonly rate: number;
  // The tick by which it is laid down.
  readonly end: number;
  readonly tl: Timeline;
  // What it covers once laid down, in the scene's coordinates.
  readonly box: Box;
  // Where it grows from, page pt (y up): its stem's start, a leaf's or
  // spray's base, a bloom's centre.
  readonly at: Pt;
}

// What every piece of one garden is painted with.
export interface Ink {
  readonly width: number;
  readonly height: number;
  readonly palette?: Readonly<Record<string, unknown>>;
  readonly paper?: RGB;
}

// The frame of piece p at tick t: nothing before it starts, its finished
// painting once laid down.
export function frameOf(p: Piece, t: number): DisplayList {
  return p.tl.at(Math.max(0, (t - p.start) * p.rate));
}

// Piece `id` of `kind`, painted by `paint` on a painter of its own and
// starting at tick `start`; its growth runs `rate` per tick.
export function pieceOf(ink: Ink, id: number, kind: string, start: number, rate: number, at: Pt, paint: (pt: Painter) => void): Piece {
  const pt = new Painter({ width: ink.width, height: ink.height, timed: true, paper: ink.paper, palette: ink.palette as never });
  paint(pt);
  const tl = new Timeline(pt.scene());
  const box = boxOf(tl.at(Infinity).items);
  return { id, kind, start, rate, end: start + Math.ceil(tl.end / rate), tl, box, at };
}

// What `items` paint, within the clips they are painted in.
function boxOf(items: readonly Item[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (list: readonly Item[], c: Box) => {
    for (const it of list) {
      if (it.kind === "clip") {
        const b = pathBox(it.path);
        if (b !== null) walk(it.items, [Math.max(c[0], b[0]), Math.max(c[1], b[1]), Math.min(c[2], b[2]), Math.min(c[3], b[3])]);
        continue;
      }
      if (it.kind === "image") continue;
      const b = pathBox(it.path);
      if (b === null) continue;
      const pad = it.kind === "stroke" ? it.width / 2 + 1 : 1;
      const bx0 = Math.max(c[0], b[0] - pad), by0 = Math.max(c[1], b[1] - pad), bx1 = Math.min(c[2], b[2] + pad), by1 = Math.min(c[3], b[3] + pad);
      if (bx0 > bx1 || by0 > by1) continue;
      x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0);
      x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
    }
  };
  walk(items, [-Infinity, -Infinity, Infinity, Infinity]);
  return x0 <= x1 ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

// A stretch of stem along `pts`, from full width w0 to w1: brushed as the
// plant's own stems are where it is wide, pen work where it is thin.
export function stem(pt: Painter, rng: Rng, pts: readonly Pt[], w0: number, w1: number): void {
  if (pts.length < 2) return;
  if (Math.max(w0, w1) >= 1.6) {
    B.stem(pt, rng, pts, (t) => w0 + (w1 - w0) * t, tune.PLANT);
    return;
  }
  const b = new S.Batch();
  b.stem(pts, w0, w1);
  b.paintLaid(pt, b.lays(), PAL.ink);
}

// A leaf whose base sits at (x, y), heading `ang`, up to `len` long.
export function leaf(pt: Painter, rng: Rng, x: number, y: number, ang: number, len: number): void {
  L.leaf(pt, rng, x, y, ang, L.options(rng, len, ang, (k) => pt.factor(k)));
}

// A bloom of radius R at (x, y) in a style drawn by weight.
export function bloom(pt: Painter, rng: Rng, x: number, y: number, R: number): void {
  const w: Record<string, number> = {};
  for (const [k, st] of Object.entries(tune.BLOOMS)) w[k] = st.weight;
  pt.lay([{ from: [x, y] }], () => F.bloom(pt, rng, x, y, R, { style: rng.weighted(w) ?? "fan" }));
}

// A bloom of radius R at (x, y) on a stalk from stem point s, whose stem
// runs along `tangent`: the stalk inked first, then the bloom opening.
export function stalked(pt: Painter, rng: Rng, s: Pt, tangent: number, x: number, y: number, R: number): void {
  const c: Pt = [x, y];
  const stalk = G.link(s, G.depart(s, tangent, c, 0.35), c, G.angle(s, c));
  const b = new S.Batch();
  b.line(stalk, 2);
  b.paintLaid(pt, sprayLays(b, s), PAL.ink);
  const w: Record<string, number> = {};
  for (const [k, st] of Object.entries(tune.BLOOMS)) w[k] = st.weight;
  pt.lay([{ from: c, start: G.length(stalk) }], () => F.bloom(pt, rng, x, y, R, { style: rng.weighted(w) ?? "fan" }));
}

// The hero bloom, of radius R at (x, y), on a stalk from stem point s
// when given: the stalk inked first.
export function stalkedHero(pt: Painter, rng: Rng, s: Pt, x: number, y: number, R: number): void {
  const c: Pt = [x, y];
  const stalk = G.link(s, G.angle(s, c), c, G.angle(s, c));
  const b = new S.Batch();
  b.line(stalk, 1);
  b.paintLaid(pt, sprayLays(b, s), PAL.ink);
  pt.lay([{ from: c, start: G.length(stalk) }], () => F.hero(pt, rng, x, y, R));
}

// The hero bloom, of radius R at (x, y).
export function hero(pt: Painter, rng: Rng, x: number, y: number, R: number): void {
  pt.lay([{ from: [x, y] }], () => F.hero(pt, rng, x, y, R));
}

// A gilt sparkle of size r at (x, y).
export function sparkle(pt: Painter, x: number, y: number, r: number, kind: string): void {
  pt.lay([{ from: [x, y], reach: r * 2 + 1, dur: 12 }], () => O.sparkles(pt, [{ x, y, r, kind }]));
}

// A gilt compass star of radius R at (x, y).
export function compass(pt: Painter, x: number, y: number, R: number): void {
  pt.lay([{ from: [x, y], dur: 20 }], () => O.compass(pt, x, y, R, { hair: 0.9, ring: 0 }));
}

// A spray of `kind` ("gyps", "cyme" or "umbel") from stem point s, whose
// stem runs along `tangent`, toward (x, y) with room r. Its stalk is
// inked first and each stalk after the one it leaves; each floret, bud and
// star opens once its stalk's ink reaches it.
export function spray(pt: Painter, rng: Rng, kind: string, s: Pt, tangent: number, x: number, y: number, r: number): void {
  const b = new S.Batch();
  const d = G.dist(s, [x, y]);
  // fill.grow's growers, but for its stalk, which this spray draws itself.
  const chord = G.angle(s, [x, y]);
  const dir0 = G.depart(s, tangent, [x, y], 0.35);
  const a = chord + G.turn(chord, dir0) * 0.6;
  const base = G.polar(s, chord, Math.max(d - r * 0.55, 3));
  b.line(G.link(s, dir0, base, a), d > 30 ? 2 : 3);
  if (kind === "gyps") S.gypsophila(b, rng, base, a, r * 0.5, r >= 14 ? 5 : r >= 8 ? 4 : 3);
  else if (kind === "cyme") S.cyme(b, rng, base, a, r * 1.25, rng.chance(0.5) ? 1 : -1);
  else S.umbel(b, rng, base, a, r * 0.85);
  // Fine sprays are pen work in a diluted ink, as compose paints them.
  b.paintLaid(pt, sprayLays(b, s), mixInk(PAL.ink, PAL.sky, 0.4));
}

// How spray batch `b`, grown from point `root`, is laid down: each line
// from the time the ink reaches its first point along the lines it leaves
// (the root's at 0), at a pt of line per pt of growth; each floret, bud and
// star as the ink reaches the end of the line it sits on.
export function sprayLays(b: S.Batch, root: Pt): Lay[] {
  const lines: { pts: Pt[]; half: number; arc: number[]; start: number }[] = [];
  for (const [pts, half] of b.spines) if (pts.length > 1) lines.push({ pts, half: half + 1, arc: arcs(pts), start: Infinity });
  for (let i = 0; i < 3; i++) for (const pts of b.lineSpines[i]) if (pts.length > 1) lines.push({ pts, half: 2, arc: arcs(pts), start: Infinity });
  // When the ink reaches point q: along the line nearest it.
  const reach = (q: Pt, skip: number): number => {
    let best = G.dist(q, root) < 2 ? 0 : Infinity, bd = G.dist(q, root);
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      if (j === skip || l.start === Infinity) continue;
      for (let i = 0; i < l.pts.length; i++) {
        const dd = G.dist(q, l.pts[i]);
        if (dd < bd - 1e-9) {
          bd = dd;
          best = l.start + l.arc[i];
        }
      }
    }
    return best;
  };
  // Lines take their starts from those already timed, the root's first;
  // a line nothing reaches starts with the root.
  for (let pass = 0; pass < lines.length + 1; pass++) {
    let changed = false;
    for (let j = 0; j < lines.length; j++) {
      const t = reach(lines[j].pts[0], j);
      if (t < lines[j].start - 1e-9) {
        lines[j].start = t;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const l of lines) if (l.start === Infinity) l.start = 0;
  const out: Lay[] = lines.map((l) => ({ along: l.pts, half: l.half, start: l.start }));
  // A floret at the end of a line opens once the last such line is inked;
  // any other once the ink reaches the line point nearest it.
  const ends = (q: Pt): number => {
    let t = -Infinity;
    for (const l of lines) if (G.dist(q, l.pts[l.pts.length - 1]) < 1) t = Math.max(t, l.start + l.arc[l.arc.length - 1]);
    return t === -Infinity ? reach(q, -1) : t;
  };
  const open = (x: number, y: number, size: number, k: number) => out.push({ from: [x, y], reach: size * k + 1, dur: 3 * size, start: ends([x, y]) });
  for (const f of b.florets) open(f.x, f.y, f.r, 1.6);
  for (const d of b.buds) open(d.x, d.y, d.len, 1.3);
  for (const st of b.stars) open(st.x, st.y, st.r, 1.2);
  return out;
}

function arcs(pts: readonly Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + G.dist(pts[i - 1], pts[i]));
  return out;
}
