// Page layouts as frames. compose always grows one plant in a left margin;
// a layout places one or more such plants on the page by giving each its
// own frame: a local page whose left margin is the band the plant should
// fill, and a map from that local page back to the paper.
//
//   left      the outer left margin (the default; the page's own spec)
//   right     the left layout mirrored into the right margin
//   centered  two plants, one in each side margin, on separate seeds
//   split     right on odd pages, left on even ones (two-sided documents)
//   title     two plants crowning a title block, rooted beside it and
//             arching over it to meet at the top centre
//   surround  a wreath: one plant up the left margin and along the foot,
//             another, turned half a circle, down the right and along the top
//   flank     two plants up the sides of a title page, round its contents,
//             their roots meeting at the foot round a centre piece
//   wreath    an open oval garland round the title: two plants laid along
//             an oval (oval.ts), rooted at its foot, meeting at its top
//   bouquet   one upright bouquet behind the title, as two plants that hug
//             its centre line, each title line on a ribbon (orn_ribbon.ts)
//   scrollwork  a gilt scroll frame on an oval round the title
//             (orn_scrollwork.ts), with lighter plants twined over it
//
// A map is an affine matrix [a, b, c, d, e, f]: page = (a x + c y + e,
// b x + d y + f). The affine layouts turn by quarter circles or mirrors, so
// boxes stay axis-aligned in every frame. A curved frame (the wreath's)
// carries its map as functions instead: `fn` to the page, `inv` back.
import { mod } from "#platform";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import type { Box } from "./layout.ts";
import { toNumber, weight, type Mix } from "./mix.ts";
import * as Ribbon from "./orn_ribbon.ts";
import * as Scrollwork from "./orn_scrollwork.ts";
import * as Title from "./orn_title.ts";
import { Oval } from "./oval.ts";
import type { Painter, Projection } from "./paint.ts";
import type { Rect } from "./plant.ts";
import { COMPOSE, type Palette } from "./tune.ts";

export const ORDER = ["left", "right", "centered", "split", "title", "surround", "flank", "wreath", "bouquet", "scrollwork"];

// What each layout does, for the guide.
export const ABOUT: Readonly<Record<string, string>> = {
  left: "The left margin. The default.",
  right: "The right margin.",
  centered: "Both side margins, with a different plant on each side.",
  split: "The outer margin of a two-sided document: on the right of odd pages and the left of even ones.",
  title: "A crown over a title. Wrap the title in the floratitle environment; without it the first block of lines on the page is crowned.",
  surround: "A wreath round the text block, for title pages and contents.",
  flank: "A title page: a plant up each side of its contents, their roots meeting at the foot round a crest.",
  wreath: "A title page: an open oval garland round the title, tied at its foot.",
  bouquet: "A title page: one upright bouquet tied with a bow, behind the title, each title line on a ribbon.",
  scrollwork: "A title page: an oval gilt scroll frame round the title, with a crest at its head and the flora twined over it.",
};

// A page of flora to grow: the page and its text (layout.ts PageSpec),
// the title furniture's seed and ornaments, and everything compose reads.
export interface FloraSpec extends Title.TitleSpec {
  readonly layout?: string;        // ORDER
  readonly page?: number;          // the page number, for split
  readonly title?: Box;            // the title block, for the title layouts
  readonly mix?: Mix;
  readonly palette?: Palette;
  readonly spin?: number | string; // colour spin (mix.ts resolve)
  readonly grow?: number;          // a growth frame, 0-1 (clock.ts)
  readonly backdrop?: RGB;         // the dark ground ink is repainted for
  readonly budget?: number;        // the caps on growth scaled (mix.ts budget)
}

// The six numbers of an affine map.
export type Affine = readonly [number, number, number, number, number, number];

// One plant's frame: its own page, and its map to the paper (`map` for an
// affine frame, `fn` and `inv` for any); the default layout's frame is the
// page itself, with no map.
export interface Frame {
  readonly spec: FloraSpec;
  readonly map?: Affine;
  readonly fn?: Projection;
  readonly inv?: Projection;
  readonly label?: string;
}

// A page's frames, and what the layout paints round them.
export interface Frames {
  readonly frames: Frame[];
  readonly title?: Title.Piece[];                    // title furniture
  readonly before?: (this: void, pt: Painter) => void; // painted under the plants
  readonly after?: (this: void, pt: Painter) => void;  // painted over them
  readonly oval?: Oval;
  readonly tie?: Pt;                                 // the bouquet's bow
  readonly scrollwork?: Scrollwork.Plan;
}

// Apply matrix m to (x, y).
export function apply(m: Affine, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) <= 1e-9) throw new Error("frame map is singular");
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

// Box bx under matrix m.
function mapBox(m: Affine, bx: Box): Box {
  const [ax, ay] = apply(m, bx.x0, bx.y0);
  const [bx2, by2] = apply(m, bx.x1, bx.y1);
  return { x0: Math.min(ax, bx2), y0: Math.min(ay, by2), x1: Math.max(ax, bx2), y1: Math.max(ay, by2) };
}

function clip(bx: Box, w: number, h: number): Box | undefined {
  const c = { x0: Math.max(0, bx.x0), y0: Math.max(0, bx.y0), x1: Math.min(w, bx.x1), y1: Math.min(h, bx.y1) };
  return c.x1 <= c.x0 || c.y1 <= c.y0 ? undefined : c;
}

interface FrameOptions {
  readonly block?: Box;      // a page box standing in for the text block
  readonly header?: boolean; // carry the running head
  readonly closed?: Rect[];
  readonly frame_only?: boolean;
  readonly seed?: number;
  readonly label?: string;
}

// A page spec being built for a frame.
type Spec = { -readonly [K in keyof FloraSpec]: FloraSpec[K] };

// Set field k of s to v, or remove it when v is undefined. A spread with
// `k: undefined` cannot remove a field in the Lua build: a nil in a table
// constructor leaves the spread's value in place.
function set<K extends keyof FloraSpec>(s: Spec, k: K, v: FloraSpec[K]): void {
  if (v === undefined) delete s[k];
  else s[k] = v;
}

// A frame of size w x h whose map to the page is `m`. The page's text block
// (or `block`) and its measured lines are carried into the frame; lines
// outside the frame are dropped.
function frame(spec: FloraSpec, m: Affine, w: number, h: number, o: FrameOptions = {}): Frame {
  const inv = invert(m);
  const text = clip(mapBox(inv, o.block ?? spec.text), w, h);
  if (text === undefined) throw new Error("layout: the text block lies outside its frame");
  let lines: Box[] | undefined;
  if (spec.lines !== undefined) {
    lines = [];
    for (const l of spec.lines) {
      const c = clip(mapBox(inv, l), w, h);
      if (c !== undefined) lines.push(c);
    }
  }
  const s: Spec = { ...spec, width: w, height: h, text };
  set(s, "lines", lines);
  set(s, "header_y", o.header === true ? spec.header_y : undefined);
  set(s, "closed", o.closed);
  // A wreath or a crown frames the text; it does not grow into it.
  set(s, "frame_only", o.frame_only);
  set(s, "layout", undefined);
  set(s, "seed", o.seed ?? spec.seed);
  return { spec: s, map: m, fn: (x, y) => apply(m, x, y), label: o.label };
}

// The frame box round page box `bx` under a curved frame's inverse map,
// sampled every 4 pt along the box's edges; undefined when it misses the
// frame.
function invBox(inv: Projection, bx: Box, w: number, h: number): Box | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (px: number, py: number) => {
    const [x, y] = inv(px, py);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const nx = Math.max(1, Math.ceil((bx.x1 - bx.x0) / 4));
  const ny = Math.max(1, Math.ceil((bx.y1 - bx.y0) / 4));
  for (let i = 0; i <= nx; i++) {
    const x = bx.x0 + ((bx.x1 - bx.x0) * i) / nx;
    add(x, bx.y0);
    add(x, bx.y1);
  }
  for (let j = 1; j < ny; j++) {
    const y = bx.y0 + ((bx.y1 - bx.y0) * j) / ny;
    add(bx.x0, y);
    add(bx.x1, y);
  }
  return clip({ x0, y0, x1, y1 }, w, h);
}

// A curved frame of size w x h, mapped to the page by fn and back by inv,
// whose text block is `text` (in frame coordinates). The page's measured
// lines are carried in through inv. It only frames the text; `density`
// scales the plant's density.
function curved(spec: FloraSpec, fn: Projection, inv: Projection, w: number, h: number, text: Box, o: { seed?: number; density?: number; label?: string }): Frame {
  let lines: Box[] | undefined;
  if (spec.lines !== undefined) {
    lines = [];
    for (const l of spec.lines) {
      const c = invBox(inv, l, w, h);
      if (c !== undefined) lines.push(c);
    }
  }
  let mix = spec.mix;
  if (o.density !== undefined) mix = { ...(spec.mix ?? {}), density: weight(spec.mix, "density") * o.density };
  const s: Spec = { ...spec, width: w, height: h, text, frame_only: true, bare: true };
  set(s, "lines", lines);
  set(s, "header_y", undefined);
  set(s, "layout", undefined);
  set(s, "seed", o.seed ?? spec.seed);
  set(s, "mix", mix);
  return { spec: s, fn, inv, label: o.label };
}

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

// A frame's seed, so the plants of one page differ but each reproduces.
function seedOf(spec: FloraSpec, k: number): number {
  return (toNumber(spec.seed) ?? 1) * 31 + k * 7907;
}

// The hero bloom's radius for a frame whose margin runs from `edge` to text
// x0 (compose's rule), used to keep two heroes from colliding.
function heroRadius(spec: FloraSpec, x0: number): number {
  const mw = x0 - (spec.gutter ?? 9) - (spec.edge ?? 16);
  return G.clamp(mw * COMPOSE.hero, 28, 80);
}

// The rectangles of page boxes `keep`, each padded by `pad`, as frame f
// sees them, for its plant to keep out of.
function closedFor(f: Frame, keep: readonly Rect[], pad: number, w: number, h: number): Rect[] {
  const out: Rect[] = [];
  if (f.map === undefined) return out;
  const inv = invert(f.map);
  for (const k of keep) {
    const c = clip(mapBox(inv, { x0: k[0] - pad, y0: k[1] - pad, x1: k[2] + pad, y1: k[3] + pad }), w, h);
    if (c !== undefined) out.push([c.x0, c.y0, c.x1, c.y1]);
  }
  return out;
}

const withClosed = (f: Frame, closed: readonly Rect[]): Frame => ({ ...f, spec: { ...f.spec, closed } });

// The frames for a page. With the default layout this is the page itself,
// unmapped. `spec.layout` names the layout; `spec.page` (for split) the
// page number; `spec.title` (for the title layouts) the title block,
// defaulting to the measured ink of the top of the text block.
export function of(spec: FloraSpec): Frames {
  let layout = spec.layout ?? "left";
  const W = spec.width, H = spec.height;
  if (!ORDER.includes(layout)) throw new Error("unknown layout " + layout);
  if (layout === "split") layout = mod(spec.page ?? 1, 2) === 1 ? "right" : "left";
  if (layout === "left") return { frames: [{ spec }] };
  if (layout === "right") return { frames: [frame(spec, [-1, 0, 0, 1, W, 0], W, H, { header: true })] };
  if (layout === "centered") {
    const half = W / 2;
    return {
      frames: [
        frame(spec, IDENTITY, half, H, { label: "left" }),
        frame(spec, [-1, 0, 0, 1, W, 0], half, H, { seed: seedOf(spec, 2), label: "right" }),
      ],
    };
  }
  if (layout === "surround") {
    // Each plant keeps to its own margin and its own end band, so the two
    // meet in a pinwheel: the first owns the left margin up to the text's
    // top and the whole foot; the second, turned 180 degrees, owns the
    // right margin down to the text's foot and the whole top band.
    const fs = [
      frame(spec, IDENTITY, W, H, { label: "left", frame_only: true }),
      frame(spec, [-1, 0, 0, -1, W, H], W, H, { seed: seedOf(spec, 2), label: "right", frame_only: true }),
    ];
    return {
      frames: fs.map((f) => {
        const ft = f.spec.text;
        return withClosed(f, [
          [ft.x1, ft.y0 - 6, W, H], // the other plant's margin
          [0, ft.y1 + 4, W, H],     // the other plant's end band
        ]);
      }),
    };
  }
  if (layout === "title") {
    const B = spec.title ?? topBlock(spec);
    // The left plant's frame is the page turned a quarter: its left margin
    // is the band above the title, its foot the strip beside the title, and
    // its top the page's centre line. The right plant mirrors it. The two
    // crowns stop short of the centre line, leaving the gap at the top
    // centre that the crest (orn_title.ts) fills.
    const depth = Math.min(H, H - B.y0 + 60);
    const R = heroRadius(spec, H - B.y1);
    const crest = Title.crestSize(spec, R);
    const half = W / 2 - R * 0.47 - crest * 0.45;
    const fs = [
      frame(spec, [0, -1, 1, 0, 0, H], depth, half, { block: B, label: "left", frame_only: true }),
      frame(spec, [0, -1, -1, 0, W, H], depth, half, { block: B, seed: seedOf(spec, 2), label: "right", frame_only: true }),
    ];
    // The plants keep out of the furniture's boxes.
    const [pieces, keep] = Title.plan(spec, B, crest);
    return { frames: fs.map((f) => withClosed(f, closedFor(f, keep, 4, depth, half))), title: pieces };
  }
  if (layout === "flank") return flank(spec);
  if (layout === "wreath") return wreath(spec);
  if (layout === "bouquet") return bouquet(spec);
  return scrollwork(spec);
}

// The measured lines' extent across the page, made symmetric about its
// centre: the column a title page's contents fill. Undefined with no lines.
function column(spec: FloraSpec): number | undefined {
  const W = spec.width, t = spec.text;
  let half: number | undefined;
  for (const l of spec.lines ?? []) {
    if (l.y1 > t.y0 - 2 && l.y0 < t.y1 + 2 && l.x1 > l.x0) half = Math.max(half ?? 0, W / 2 - l.x0, l.x1 - W / 2);
  }
  return half;
}

// Flank: a plant up each side of the contents, in the side margins the
// contents' column leaves, rooted along the foot so the two roots meet
// under the middle of the page. A crest sits in the column's lowest gap,
// or in the foot band under it (orn_title.ts).
export function flank(spec: FloraSpec): Frames {
  const W = spec.width, H = spec.height, t = spec.text;
  const edge = spec.edge ?? 16, gutter = spec.gutter ?? 9;
  // Each margin is kept between a narrow plant's width and a third of the
  // page, whatever the column.
  const mwMax = W * 0.34, mwMin = 46;
  const half = G.clamp((column(spec) ?? (t.x1 - t.x0) / 2) + 12, W / 2 - edge - gutter - mwMax, W / 2 - edge - gutter - mwMin);
  const block: Box = { x0: W / 2 - half, x1: W / 2 + half, y0: t.y0, y1: t.y1 };
  let fs: Frame[] = [
    frame(spec, IDENTITY, W / 2, H, { block, label: "left", frame_only: true }),
    frame(spec, [-1, 0, 0, 1, W, 0], W / 2, H, { block, seed: seedOf(spec, 2), label: "right", frame_only: true }),
  ];
  const piece = Title.foot(spec, block);
  if (piece === undefined) return { frames: fs };
  fs = fs.map((f) => {
    const c = closedFor(f, [piece.box], 6, W / 2, H);
    return c.length > 0 ? withClosed(f, c) : f;
  });
  return { frames: fs, title: [piece] };
}

// The oval a wreath or scroll frame follows round title block B, and its
// band: a margin `mw` wide whose curve runs `xc` in from the frame's outer
// edge. The oval spans the page's width, is centred on the block and is at
// least tall enough that the band's inner side clears the block's corners.
// Beyond that it grows, up to 1.3 times as tall as wide, into the room
// between the block and the nearest lines above and below it, less `inset`
// at each end. A line it cannot clear joins the block, so the oval frames
// it too rather than cross it.
export function oval(spec: FloraSpec, block: Box, inset = 0): [Oval, number, number] {
  const W = spec.width, H = spec.height;
  const edge = spec.edge ?? 16, gutter = spec.gutter ?? 9;
  const mw = G.clamp(W * 0.15, 56, 100);
  const xc = edge + mw * 0.4;
  const d = edge + mw + gutter - xc;
  const a = W / 2 - xc - 4;
  const ring = xc + 4 + inset;
  const lines = spec.lines ?? [];
  const B = { x0: block.x0, y0: block.y0, x1: block.x1, y1: block.y1 };
  let b = 0, cy = 0;
  for (let pass = 0; pass <= lines.length; pass++) {
    const hx = Math.max(W / 2 - B.x0, B.x1 - W / 2) + 8;
    const hy = (B.y1 - B.y0) / 2 + 8;
    const u = Math.min(0.95, hx / (a - d));
    cy = (B.y0 + B.y1) / 2;
    let lo = 0, hi = H;
    for (const l of lines) {
      if (l.y1 < B.y0 - 0.5) lo = Math.max(lo, l.y1 + 6);
      if (l.y0 > B.y1 + 0.5) hi = Math.min(hi, l.y0 - 6);
    }
    b = Math.max(d + hy / Math.sqrt(1 - u * u), Math.min(a * 1.3, cy - lo - ring, hi - cy - ring));
    let grown = false;
    for (const l of lines) {
      const outside = l.y1 < B.y0 - 0.5 || l.y0 > B.y1 + 0.5;
      if (outside && l.y1 > cy - b - ring && l.y0 < cy + b + ring) {
        B.x0 = Math.min(B.x0, l.x0);
        B.x1 = Math.max(B.x1, l.x1);
        B.y0 = Math.min(B.y0, l.y0);
        B.y1 = Math.max(B.y1, l.y1);
        grown = true;
      }
    }
    if (!grown) break;
  }
  return [new Oval(W / 2, cy, a, b), mw, xc];
}

// Two plants laid along oval `ov` with its band (oval), each up one side
// from arclength s0 past the foot to s1 short of the top, at `density`
// times the margin's.
function along(spec: FloraSpec, ov: Oval, mw: number, xc: number, s0: number, s1: number, density: number): Frame[] {
  const edge = spec.edge ?? 16, gutter = spec.gutter ?? 9;
  const xi = edge + mw + gutter;
  const w = xi + 40, h = s1 - s0;
  const text: Box = { x0: xi, y0: 0, x1: w, y1: h };
  return ["left", "right"].map((side, i) => {
    const [fn, inv] = ov.maps(s0, xc, side === "right");
    return curved(spec, fn, inv, w, h, text, { label: side, seed: i === 1 ? seedOf(spec, 2) : undefined, density });
  });
}

// Wreath: two plants laid along an oval round the title, each up one side
// from the oval's foot to its top, where their heroes meet. Each frame
// starts a little past the foot, so the two roots cross there as a tied
// wreath's do; the garland grows at 0.75 of the margin's density.
export function wreath(spec: FloraSpec): Frames {
  const B = spec.title ?? topBlock(spec);
  const [ov, mw, xc] = oval(spec, B);
  const edge = spec.edge ?? 16, gutter = spec.gutter ?? 9;
  const R = heroRadius(spec, edge + mw + gutter);
  return { frames: along(spec, ov, mw, xc, -(edge + 10), ov.len / 2 - R * 0.35, 0.75), oval: ov };
}

// Scrollwork: a gilt scroll frame on an oval round the title
// (orn_scrollwork.ts), with lighter plants twined over its band up each
// side, between the pieces at its foot and its head.
export function scrollwork(spec: FloraSpec): Frames {
  const B = spec.title ?? topBlock(spec);
  const [ov, mw, xc] = oval(spec, B, 40);
  const plan = Scrollwork.plan(spec, ov);
  const foot = plan.foot, head = plan.head;
  // The plants start beside the foot piece and stop short of the head's.
  return {
    frames: along(spec, ov, mw, xc, (foot[2] - foot[0]) * 0.45, ov.len / 2 - (head[2] - head[0]) * 0.7, 0.55),
    before: (pt) => Scrollwork.under(pt, spec, ov, plan),
    after: (pt) => Scrollwork.over(pt, spec, ov, plan),
    oval: ov, scrollwork: plan,
  };
}

// The block of measured lines at the top of the text, down to the first
// gap of more than two line heights: a title, by default.
export function topBlock(spec: FloraSpec): Box {
  const t = spec.text;
  const ls = (spec.lines ?? []).filter((l) => l.y1 > t.y0 && l.y0 < t.y1 + 2);
  G.sortBy(ls, (l) => -l.y1);
  if (ls.length === 0) return { x0: t.x0, y0: t.y1 - 80, x1: t.x1, y1: t.y1 };
  const B = { x0: ls[0].x0, y0: ls[0].y0, x1: ls[0].x1, y1: ls[0].y1 };
  for (let i = 1; i < ls.length; i++) {
    const l = ls[i];
    const h = ls[i - 1].y1 - ls[i - 1].y0;
    if (B.y0 - l.y1 > 2 * h) break;
    B.x0 = Math.min(B.x0, l.x0);
    B.x1 = Math.max(B.x1, l.x1);
    B.y0 = Math.min(B.y0, l.y0);
  }
  return B;
}

// The box around `lines` whose middles lie between heights yHi and yLo, or
// undefined when none do.
export function between(lines: readonly Box[], yHi: number, yLo: number): Box | undefined {
  let B: { x0: number; y0: number; x1: number; y1: number } | undefined;
  for (const l of lines) {
    const mid = (l.y0 + l.y1) / 2;
    if (mid <= yHi && mid >= yLo) {
      if (B === undefined) B = { x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 };
      else {
        B.x0 = Math.min(B.x0, l.x0);
        B.x1 = Math.max(B.x1, l.x1);
        B.y0 = Math.min(B.y0, l.y0);
        B.y1 = Math.max(B.y1, l.y1);
      }
    }
  }
  return B;
}

// The measured lines whose middles lie inside block B, top first.
export function linesIn(spec: FloraSpec, B: Box): Box[] {
  const out = (spec.lines ?? []).filter((l) => {
    const my = (l.y0 + l.y1) / 2;
    return my >= B.y0 - 0.5 && my <= B.y1 + 0.5 && l.x1 > B.x0 && l.x0 < B.x1;
  });
  G.sortBy(out, (l) => -l.y1);
  return out;
}

// Bouquet: one upright bouquet centred on the title, from 230 pt below it
// to 170 pt above, short of the nearest lines below and above it (its stems
// would cross them). Its two halves are plants whose outer edge is the
// bouquet's centre line: their main stems rise from it, gathered, and leave
// it over the lowest third, so the bouquet fans out from a tied foot; the
// right half stands lower, so the two heroes stagger. The title's lines
// are carried into both frames, so blooms and leaves grow between them
// while stems pass behind, and each line is painted on a ribbon over the
// finished bouquet.
export function bouquet(spec: FloraSpec): Frames {
  const W = spec.width, H = spec.height;
  const B = spec.title ?? topBlock(spec);
  const gutter = spec.gutter ?? 9;
  const cx = W / 2;
  const mw = G.clamp((B.x1 - B.x0) * 0.6, 80, W * 0.32);
  const hw = 4 + mw + gutter;
  let lo = 40, hi = H - 16;
  for (const l of spec.lines ?? []) {
    if (l.y1 < B.y0 - 0.5) lo = Math.max(lo, l.y1 + 10);
    if (l.y0 > B.y1 + 0.5) hi = Math.min(hi, l.y0 - 10);
  }
  const base = Math.max(lo, B.y0 - 230);
  const top = Math.min(hi, B.y1 + 170);
  const frames = ["left", "right"].map((side, i): Frame => {
    const s = side === "left" ? -1 : 1;
    const h = (top - base) * (i === 0 ? 1 : 0.84);
    const wf = side === "left" ? cx : W - cx;
    const block: Box = side === "left" ? { x0: 0, x1: cx - hw, y0: base, y1: base + h } : { x0: cx + hw, x1: W, y0: base, y1: base + h };
    const f = frame(spec, [s, 0, 0, 1, cx, base], wf, h, { block, label: side, frame_only: true, seed: i === 1 ? seedOf(spec, 2) : undefined });
    // The bouquet's outline: a quarter of its width at the tie, full from
    // just past halfway, rounding over at the top.
    const closed: Rect[] = [];
    for (let y = 0; y <= h; y += 6) {
      const u = y / h;
      const k = 0.25 + 0.75 * G.smoothstep(0, 0.55, u) - 0.25 * G.smoothstep(0.82, 1, u);
      closed.push([4 + mw * k + 2, y, wf, y + 6]);
    }
    return { ...f, spec: { ...f.spec, bare: true, edge: 4, gather: h * 0.3, closed } };
  });
  const lines = linesIn(spec, B);
  // The bow's tails hang about its own size below the knot, and stay above
  // the bouquet's foot.
  const bow = G.clamp(mw * 0.6, 34, 56);
  const tie: Pt = [cx, Math.max(base + (top - base) * 0.11, base + bow)];
  return {
    frames, tie,
    after: (pt) => {
      Ribbon.bow(pt, tie[0], tie[1], bow);
      Ribbon.paint(pt, lines);
    },
  };
}
