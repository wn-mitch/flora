// Gilded marginalia: compass stars, sparkles, edge chains, knot lozenges,
// the inset star panel and the knot pendant.
import { mod } from "#platform";
import * as C from "./color.ts";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as K from "./orn_kit.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";
import * as W from "./wash.ts";

const PI = Math.PI;

function tri(a: Pt, b: Pt, c: Pt): Cmd[] {
  return [["m", a[0], a[1]], ["l", b[0], b[1]], ["l", c[0], c[1]], ["z"]];
}

export interface CompassOptions {
  readonly hair?: number; // length factor of the thin crosshair lines (0 for none)
  readonly ring?: number; // number of dots circling the star
}

// An eight-point compass star. Each ray has a lit and a shaded half.
export function compass(pt: Painter, x: number, y: number, R: number, o: CompassOptions = {}): void {
  const c: Pt = [x, y];
  const lit: Cmd[][] = [], shade: Cmd[][] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * PI) / 4 + PI / 2;
    const major = mod(k, 2) === 0;
    const len = major ? R : R * 0.48;
    const half = major ? 0.11 : 0.13;
    const tip = G.polar(c, a, len);
    lit.push(tri(c, tip, G.polar(c, a + PI / 4, len * half)));
    shade.push(tri(c, tip, G.polar(c, a - PI / 4, len * half)));
  }
  const hair = o.hair ?? 1.7;
  if (hair > 0) {
    const h = R * hair;
    pt.strokeMany([G.polyline([[x, y - h], [x, y + h]], false), G.polyline([[x - h, y], [x + h, y]], false)], PAL.gold, 0.22, 0.75);
  }
  pt.fillMany(shade, PAL.copper, 0.95);
  pt.fillMany(lit, PAL.gold, 0.95);
  pt.fill([["o", x, y, R * 0.07]], PAL.cream, 1);
  pt.stroke([["o", x, y, R * 0.07]], PAL.copper, 0.2, 0.9);
  const ring = o.ring ?? 8;
  if (ring > 0) {
    const dots: Cmd[][] = [];
    for (let k = 0; k < ring; k++) {
      const p = G.polar(c, ((k + 0.5) * 2 * PI) / ring + PI / 2, R * 0.62);
      dots.push([["o", p[0], p[1], R * 0.035]]);
    }
    pt.fillMany(dots, PAL.gold, 0.9);
  }
}

// A four-point sparkle of radius r at (x, y), as a path.
export function sparkle(x: number, y: number, r: number): Cmd[] {
  const k = r * 0.16;
  return [
    ["m", x, y + r], ["c", x, y + k, x + k, y, x + r, y], ["c", x + k, y, x, y - k, x, y - r],
    ["c", x, y - k, x - k, y, x - r, y], ["c", x - k, y, x, y + k, x, y + r], ["z"],
  ];
}

// A piece of small gilt in the gaps of the foliage: kind "plain" (a
// four-point sparkle), "dotted" (a sparkle with four dots on its
// diagonals), "cross" (a slender sparkle with a dot past each point),
// "rosette" (four dots round a copper heart), "lozenge" (a small lozenge on
// a short dotted thread), "star5", "crescent" or "trefoil".
export interface Sparkle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly kind?: string;
}

// Small gilt, batched.
export function sparkles(pt: Painter, items: readonly Sparkle[]): void {
  const paths: Cmd[][] = [], dots: Cmd[][] = [], hearts: Cmd[][] = [], stars: Cmd[][] = [];
  for (const s of items) {
    const { x, y, r } = s;
    const kind = s.kind ?? "plain";
    if (kind === "lozenge") {
      lozenge(pt, x, y, r * 0.8);
    } else if (kind === "rosette") {
      for (let k = 0; k < 4; k++) {
        const p = G.polar([x, y], (k * PI) / 2, r * 0.5);
        dots.push([["o", p[0], p[1], r * 0.3]]);
      }
      hearts.push([["o", x, y, r * 0.2]]);
    } else if (kind === "star5") {
      stars.push(G.polyline(K.star(x, y, r * 0.75, r * 0.3, 5), true));
    } else if (kind === "crescent") {
      stars.push(G.smooth(K.crescent(x, y, r * 0.62, 0.62, PI / 4), true));
      dots.push([["o", x + r * 0.8, y - r * 0.45, r * 0.1]]);
    } else if (kind === "trefoil") {
      for (const p of K.trefoil(x, y - r * 0.1, r * 0.8, PI / 2)) dots.push(p);
      hearts.push([["o", x, y - r * 0.05, r * 0.12]]);
    } else if (kind === "cross") {
      paths.push(sparkle(x, y, r));
      for (let k = 0; k < 4; k++) {
        const p = G.polar([x, y], (k * PI) / 2, r * 1.4);
        dots.push([["o", p[0], p[1], r * 0.13]]);
      }
    } else {
      paths.push(sparkle(x, y, r));
      if (kind === "dotted") {
        for (let k = 0; k < 4; k++) {
          const p = G.polar([x, y], PI / 4 + (k * PI) / 2, r * 0.75);
          dots.push([["o", p[0], p[1], r * 0.1]]);
        }
      }
    }
  }
  if (paths.length > 0) pt.fillMany(paths, PAL.gold, 0.9);
  if (dots.length > 0) pt.fillMany(dots, PAL.gold, 0.85);
  if (stars.length > 0) pt.fillMany(stars, PAL.gold, 0.92);
  if (hearts.length > 0) pt.fillMany(hearts, PAL.copper, 0.85);
}

// A lozenge of half-height h at (x, y): a gilt outline round a copper
// heart, with a dot above and below.
export function lozenge(pt: Painter, x: number, y: number, h: number): void {
  const w = h * 0.6;
  const outline = G.polyline([[x, y + h], [x + w, y], [x, y - h], [x - w, y]], true);
  pt.fill(G.polyline([[x, y + h * 0.45], [x + w * 0.45, y], [x, y - h * 0.45], [x - w * 0.45, y]], true), PAL.copper, 0.85);
  pt.stroke(outline, PAL.gold, 0.25, 0.9);
  pt.fillMany([[["o", x, y + h * 1.5, h * 0.12]], [["o", x, y - h * 1.5, h * 0.12]]], PAL.gold, 0.9);
}

// A dotted cross of size s: four dots round a larger centre dot.
export function dotCross(pt: Painter, x: number, y: number, s: number): void {
  const dots: Cmd[][] = [[["o", x, y, s * 0.2]]];
  for (let k = 0; k < 4; k++) {
    const p = G.polar([x, y], (k * PI) / 2, s);
    dots.push([["o", p[0], p[1], s * 0.11]]);
  }
  pt.fillMany(dots, PAL.gold, 0.9);
}

// A finial of size s: a slender cross, a drop hanging below it.
export function finial(pt: Painter, x: number, y: number, s: number): void {
  pt.strokeMany([G.polyline([[x, y + s], [x, y - s * 0.6]], false), G.polyline([[x - s * 0.45, y + s * 0.35], [x + s * 0.45, y + s * 0.35]], false)], PAL.copper, 0.3, 0.9);
  const d = y - s * 0.6;
  pt.fill([["m", x, d - s * 0.7], ["c", x + s * 0.35, d - s * 0.25, x + s * 0.18, d, x, d + s * 0.05], ["c", x - s * 0.18, d, x - s * 0.35, d - s * 0.25, x, d - s * 0.7], ["z"]], PAL.gold, 0.9);
}

// A scroll hook of height s, opening to side `dir` (+1 right): a hairline
// C that curls in at its foot.
export function hook(pt: Painter, x: number, y: number, s: number, dir: number): void {
  const b = -dir * s * 0.62;
  const pts = G.splinePoints([[x, y + s], [x + b, y + s * 0.4], [x + b, y - s * 0.4], [x, y - s * 0.8], [x - b * 0.35, y - s * 0.55]], 6);
  pt.stroke(G.polyline(pts, false), PAL.gold, 0.28, 0.85);
  pt.fill([["o", x, y + s, s * 0.09]], PAL.gold, 0.9);
}

const CHAIN_STOPS: Readonly<Record<string, number>> = { lozenge: 3, cross: 2, finial: 2, hook: 1.5, knot: 1.5 };

// A gilt chain down the outer edge at x, from ytop to ybot, broken by
// small motifs (lozenges, dotted crosses, finials, scroll hooks and knots)
// about every 40-70 pt. Each stretch between motifs is a row of dots or,
// now and then, a hairline rod with a dot at either end. With foot "knot"
// the chain ends in a knot pendant at ybot.
export function chain(pt: Painter, rng: Rng, x: number, ytop: number, ybot: number, foot?: "knot"): void {
  const stops: { y: number; kind: string; half: number }[] = [];
  let y = ytop - rng.range(10, 24);
  const last = foot !== undefined ? ybot + 34 : ybot + 8;
  while (y > last) {
    const kind = rng.weighted(CHAIN_STOPS) ?? "lozenge";
    stops.push({ y, kind, half: kind === "knot" ? 8 : kind === "hook" ? 7 : 5.5 });
    y -= rng.range(40, 70);
  }
  if (foot !== undefined && ytop - ybot >= 18) stops.push({ y: ybot + 8, kind: "knot", half: 8 });
  // The stretches between motifs (and the chain's ends).
  const spans: [number, number][] = [];
  let from = ytop;
  for (const s of stops) {
    spans.push([from, s.y + s.half + 2]);
    from = s.y - s.half - 2;
  }
  spans.push([from, ybot]);
  const dots: Cmd[][] = [], rods: Cmd[][] = [];
  for (const [a, b] of spans) {
    if (a - b > 3) {
      if (a - b > 14 && rng.chance(0.35)) {
        rods.push(G.polyline([[x, a - 1.5], [x, b + 1.5]], false));
        dots.push([["o", x, a, 0.55]], [["o", x, b, 0.55]]);
      } else {
        for (let yy = a; yy >= b; yy -= 4.6) dots.push([["o", x, yy, 0.5]]);
      }
    }
  }
  if (rods.length > 0) pt.strokeMany(rods, PAL.gold, 0.25, 0.8);
  if (dots.length > 0) pt.fillMany(dots, PAL.gold, 0.85);
  for (const s of stops) {
    if (s.kind === "lozenge") lozenge(pt, x, s.y, 3.6);
    else if (s.kind === "cross") dotCross(pt, x, s.y, 3);
    else if (s.kind === "finial") finial(pt, x, s.y, 4.5);
    else if (s.kind === "hook") hook(pt, x, s.y, 6, rng.chance(0.5) ? 1 : -1);
    else knot(pt, x, s.y, 4.8, 7.2);
  }
}

// A large pale knot medallion of radius r at (x, y), where the edge chain
// meets the foot: an interlaced lozenge and quatrefoil inside a dotted ring.
export function medallion(pt: Painter, x: number, y: number, r: number): void {
  pt.groupBegin(0.55);
  knot(pt, x, y, r * 0.62, r * 0.8);
  const dots: Cmd[][] = [];
  for (let k = 0; k < 16; k++) {
    const p = G.polar([x, y], (k * PI) / 8, r);
    dots.push([["o", p[0], p[1], r * 0.045]]);
  }
  pt.fillMany(dots, PAL.gold, 0.9);
  pt.stroke([["o", x, y, r * 0.86]], PAL.gold, 0.22, 0.7);
  pt.groupEnd();
}

// A lozenge knot: a rhombus threaded with four loops and a small core.
export function knot(pt: Painter, x: number, y: number, w: number, h: number): void {
  const paths: Cmd[][] = [
    G.polyline([[x, y + h], [x + w, y], [x, y - h], [x - w, y]], true),
    G.polyline([[x, y + h * 0.45], [x + w * 0.45, y], [x, y - h * 0.45], [x - w * 0.45, y]], true),
  ];
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) paths.push([["o", x + d[0] * w * 0.5, y + d[1] * h * 0.5, Math.min(w, h) * 0.26]]);
  pt.strokeMany(paths, PAL.gold, 0.3, 0.85);
  pt.fill([["o", x, y, Math.min(w, h) * 0.1]], PAL.copper, 0.85);
}

// A rectangle (x0, y0)-(x1, y1) with a concave quarter-circle notch of
// radius c at each corner, as a closed polygon (n points per straight side).
function notched(x0: number, y0: number, x1: number, y1: number, c: number, n: number): Pt[] {
  const corners: [number, number, number][] = [[x0, y0, PI / 2], [x1, y0, PI], [x1, y1, (3 * PI) / 2], [x0, y1, 0]];
  const out: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const q = corners[k];
    for (let s = 0; s <= 4; s++) out.push(G.polar([q[0], q[1]], q[2] - ((s / 4) * PI) / 2, c));
    const nq = corners[mod(k + 1, 4)];
    const a = out[out.length - 1], b = G.polar([nq[0], nq[1]], nq[2], c);
    for (let s = 1; s < n; s++) out.push(G.mix(a, b, s / n));
  }
  return out;
}

// A puff of cloud: its centre and radius.
export type Puff = readonly [number, number, number];

// Cloud banks over the field (x0, y0)-(x1, y1): a few drifting rows of
// overlapping puffs, leaving clear sky between them.
export function cloudPuffs(rng: Rng, x0: number, y0: number, x1: number, y1: number): Puff[] {
  const w = x1 - x0;
  const puffs: Puff[] = [];
  const banks = rng.int(4, 6);
  for (let b = 0; b < banks; b++) {
    let cx = rng.range(x0 - w * 0.2, x1), cy = rng.range(y0, y1);
    const tilt = rng.range(-0.25, 0.25);
    const size = rng.range(0.11, 0.2) * w;
    const n = rng.int(4, 8);
    for (let i = 0; i < n; i++) {
      puffs.push([cx, cy, size * rng.range(0.6, 1.2)]);
      cx += size * rng.range(0.6, 1.1);
      cy += size * (tilt + rng.jit(0.3));
    }
  }
  return puffs;
}

// How much cloud covers (x, y): 0 in clear sky, 1 inside a puff's core
// (puffs are drawn as ellipses 1.6 r across and 0.85 r tall).
function cover(puffs: readonly Puff[], x: number, y: number): number {
  let c = 0;
  for (const p of puffs) {
    const dx = (x - p[0]) / (p[2] * 1.6), dy = (y - p[1]) / (p[2] * 0.85);
    c = Math.max(c, 1 - G.smoothstep(0.35, 1, Math.sqrt(dx * dx + dy * dy)));
  }
  return c;
}

// The night sky behind the cloud: dust-fine stars, a few brighter ones as
// four-point twinkles, all fading where cloud lies over them.
export function starfield(pt: Painter, rng: Rng, puffs: readonly Puff[], x0: number, y0: number, x1: number, y1: number): void {
  const near: Cmd[][] = [], far: Cmd[][] = [];
  const twinkles: { op: number; path: Cmd[] }[] = [];
  const n = Math.floor((x1 - x0) * (y1 - y0) * 0.09);
  for (let i = 0; i < n; i++) {
    const x = rng.range(x0, x1), y = rng.range(y0, y1);
    const seen = 1 - cover(puffs, x, y);
    if (seen > 0.15) {
      const bright = rng.next() ** 3;
      if (bright > 0.8 && seen > 0.5) twinkles.push({ op: 0.85 * seen, path: sparkle(x, y, 0.7 + bright * 0.8) });
      else (seen > 0.6 ? near : far).push([["o", x, y, 0.14 + bright * 0.4]]);
    }
  }
  if (near.length > 0) pt.fillMany(near, PAL.white, 0.85);
  if (far.length > 0) pt.fillMany(far, PAL.white, 0.4);
  for (const t of twinkles) pt.fill(t.path, PAL.white, t.op);
}

// An ellipse at (x, y), rx across and ry tall, as a path.
export function ellipse(x: number, y: number, rx: number, ry: number): Cmd[] {
  const pts: Pt[] = [];
  for (let k = 0; k < 16; k++) pts.push([x + rx * Math.cos((k * PI) / 8), y + ry * Math.sin((k * PI) / 8)]);
  return G.smooth(pts, true);
}

const CLOUD_LAYERS = 6;

// Clouds as flattened puffs, each built from many faint shrinking layers so
// its edge dissolves into the sky; a faint shadow sits under each bank's
// belly and the tops catch a paler light. `sky` and `deep` are the sky's
// dilute and pooled colours.
export function clouds(pt: Painter, puffs: readonly Puff[], sky: RGB, deep: RGB): void {
  pt.fillMany(puffs.map((p) => ellipse(p[0], p[1] - p[2] * 0.35, p[2] * 1.5, p[2] * 0.6)), deep, 0.1);
  const tint = C.mix(PAL.white, sky, 0.25);
  for (let k = 1; k <= CLOUD_LAYERS; k++) {
    const sc = 1.5 - k / CLOUD_LAYERS;
    const layer = puffs.map((p) => ellipse(p[0], p[1] + p[2] * 0.06 * k, p[2] * 1.6 * sc, p[2] * 0.85 * sc));
    pt.fillMany(layer, k > CLOUD_LAYERS - 2 ? PAL.white : tint, 0.09);
  }
}

const GLOW: RGB = [0.99, 0.86, 0.72];

// A luminous star at (cx, cy) in light rather than gilt: long needle rays
// reaching rx across and ry up and down, shorter diagonals, fine rays
// between, and a soft peach glow at its heart.
export function litStar(pt: Painter, cx: number, cy: number, rx: number, ry: number): void {
  const c: Pt = [cx, cy];
  const r = Math.min(rx, ry);
  const light = C.mix(PAL.white, PAL.sky, 0.18);
  const rays: Cmd[][] = [], haze: Cmd[][] = [], fine: Cmd[][] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k * PI) / 8;
    let len: number, half: number;
    const main = mod(k, 2) === 0;
    if (mod(k, 4) === 0) {
      len = mod(k, 8) === 0 ? rx : ry;
      half = r * 0.045;
    } else if (main) {
      len = r * 0.82;
      half = r * 0.04;
    } else {
      len = r * 0.4;
      half = r * 0.022;
    }
    (main ? rays : fine).push(G.polyline([c, G.polar(c, a + PI / 2, half), G.polar(c, a, len), G.polar(c, a - PI / 2, half)], true));
    if (main) haze.push(G.polyline([c, G.polar(c, a + PI / 2, half * 3), G.polar(c, a, len * 0.8), G.polar(c, a - PI / 2, half * 3)], true));
  }
  pt.fillMany(haze, PAL.white, 0.12);
  pt.fillMany(fine, light, 0.55);
  pt.fillMany(rays, light, 0.9);
  const glows = [0.28, 0.2, 0.13, 0.07];
  for (let k = 1; k <= 4; k++) pt.fill([["o", cx, cy, r * glows[k - 1]]], k === 4 ? PAL.cream : GLOW, 0.2 + 0.18 * k);
}

// The washes a cartouche's sky may take instead of the night blue.
export interface Sky {
  readonly pigment?: RGB;
  readonly pool?: RGB;
  readonly light?: Pt;
  readonly strength?: number;
}

// A cartouche's field, for drawing inside it and for panelClose.
export interface Field {
  readonly tint: string | undefined;
  readonly deep: RGB;
  readonly dilute: RGB;
  readonly ink: RGB;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly c: number;
  readonly frame: Cmd[];
  readonly body: Pt[];
}

// The cartouche's frame and sky for the box (x, y, w, h): a square frame
// with a pale band, round a field with notched corners washed in the sky's
// ink (palette.cartouche; the gilt stays gold).
export function panelOpen(pt: Painter, rng: Rng, x: number, y: number, w: number, h: number, sky: Sky = {}): Field {
  const tint = C.partInk("cartouche", pt.palette);
  const blue = C.recolor(PAL.blue, tint);
  const band = G.clamp(w * 0.065, 1.6, 3);
  const x0 = x + band, y0 = y + band, x1 = x + w - band, y1 = y + h - band;
  const c = Math.min(w, h) * 0.09;
  const frame = G.polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  pt.fill(frame, C.mix(blue, PAL.paper, 0.86), 1);
  const body = notched(x0, y0, x1, y1, c, 6);
  W.wash(pt, body, {
    rng: rng.fork("sky"), size: Math.min(w, h), pigment: sky.pigment ?? PAL.blue, pool: sky.pool ?? PAL.deep,
    ink: tint, light: sky.light ?? [(x0 + x1) / 2, (y0 + y1) / 2], strength: sky.strength ?? 1,
    rings: 10, lift: 0.022, grain: 0.04, outline: 0, lost: 0, lifts: 0,
  });
  return {
    tint, deep: C.recolor(PAL.deep, tint), dilute: C.recolor(PAL.sky, tint), ink: C.recolor(PAL.ink, tint),
    x0, y0, x1, y1, c, frame, body,
  };
}

// The field's edge, a pale curl in each notch, and the frame's hairline.
export function panelClose(pt: Painter, f: Field): void {
  pt.stroke(G.polyline(f.body, true), C.mix(f.deep, PAL.paper, 0.35), 0.35, 0.8);
  const curls: Cmd[][] = [];
  for (const q of [[f.x0, f.y0, 0], [f.x1, f.y0, PI / 2], [f.x1, f.y1, PI], [f.x0, f.y1, (3 * PI) / 2]]) {
    const pts: Pt[] = [];
    for (let s = 0; s <= 6; s++) pts.push(G.polar([q[0], q[1]], q[2] + ((s / 6) * PI) / 2, f.c * 0.55));
    curls.push(G.polyline(pts, false));
  }
  pt.strokeMany(curls, PAL.white, 0.35, 0.9);
  pt.stroke(f.frame, C.mix(f.ink, PAL.paper, 0.25), 0.45, 0.9);
}

// The star cartouche filling the box (x, y, w, h): a night field seen
// through drifting cloud, stars in the gaps, a luminous star at its heart.
export function panel(pt: Painter, rng: Rng, x: number, y: number, w: number, h: number): void {
  const f = panelOpen(pt, rng, x, y, w, h);
  const puffs = cloudPuffs(rng.fork("clouds"), f.x0, f.y0, f.x1, f.y1);
  pt.clipBegin(G.polyline(f.body, true));
  starfield(pt, rng.fork("stars"), puffs, f.x0, f.y0, f.x1, f.y1);
  clouds(pt, puffs, f.dilute, f.deep);
  pt.clipEnd();
  panelClose(pt, f);
  litStar(pt, (f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, (f.x1 - f.x0) * 0.47, (f.y1 - f.y0) * 0.47);
}

const SHAPES: Readonly<Record<string, number>> = { ogee: 3, lozenge: 2, drop: 2, roundel: 1.5 };
const KNOTS: Readonly<Record<string, number>> = { interlace: 3, quatrefoil: 2, cross: 2 };

// A pendant knot in the foot's corner, as in the reference, filling the box
// centred at (x, y), w wide and h tall, and hung from a beaded cord running
// `cord` pt up from its top. The seed picks its outline (an ogee shield,
// lozenge, drop or roundel, drawn double) and the knot inside it (an
// interlace, a quatrefoil or a beaded cross). Painted pale, as a group.
// Returns the outline and knot chosen.
export function pendant(pt: Painter, rng: Rng, x: number, y: number, w: number, h: number, cord = 0): [string, string] {
  const shape = rng.weighted(SHAPES) ?? "ogee";
  const kn = rng.weighted(KNOTS) ?? "interlace";
  const hw = w / 2, hh = h / 2 - 2.2;
  const cy = y + 1.1;
  let half: Pt[];
  if (shape === "ogee") half = [[0, 1], [0.62, 0.86], [1, 0.42], [0.86, -0.12], [0.36, -0.62], [0, -1]];
  else if (shape === "lozenge") half = [[0, 1], [0.5, 0.48], [1, 0], [0.5, -0.48], [0, -1]];
  else if (shape === "drop") half = [[0, 1], [0.8, 0.72], [1, 0.2], [0.7, -0.4], [0, -1]];
  else {
    half = [];
    for (let k = 0; k <= 8; k++) half.push([Math.sin((k * PI) / 8), Math.cos((k * PI) / 8)]);
  }
  const outline = (sc: number): Pt[] => {
    const pts: Pt[] = half.map((q): Pt => [x + q[0] * hw * sc, cy + q[1] * hh * sc]);
    for (let i = half.length - 2; i >= 1; i--) pts.push([x - half[i][0] * hw * sc, cy + half[i][1] * hh * sc]);
    return pts;
  };
  pt.groupBegin(0.7);
  const smooth = shape !== "lozenge";
  const path = (pts: Pt[]) => (smooth ? G.smooth(pts, true) : G.polyline(pts, true));
  pt.strokeMany([path(outline(0.96)), path(outline(0.8))], PAL.gold, 0.32, 0.85);
  const paths: Cmd[][] = [], dots: Cmd[][] = [];
  const u = Math.min(hw, hh);
  if (kn === "interlace") {
    paths.push(ellipse(x, cy, u * 0.3, hh * 0.5), ellipse(x, cy, hw * 0.5, u * 0.3), [["o", x, cy, u * 0.14]]);
  } else if (kn === "quatrefoil") {
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) paths.push([["o", x + d[0] * u * 0.26, cy + d[1] * u * 0.26, u * 0.24]]);
    dots.push([["o", x, cy, u * 0.08]]);
  } else {
    paths.push(
      G.polyline([[x, cy + hh * 0.6], [x, cy - hh * 0.6]], false),
      G.polyline([[x - hw * 0.55, cy], [x + hw * 0.55, cy]], false),
      G.polyline([[x, cy + u * 0.2], [x + u * 0.2, cy], [x, cy - u * 0.2], [x - u * 0.2, cy]], true),
    );
    for (const q of [[0, hh * 0.6], [0, -hh * 0.6], [hw * 0.55, 0], [-hw * 0.55, 0]]) dots.push([["o", x + q[0], cy + q[1], 0.6]]);
  }
  pt.strokeMany(paths, PAL.gold, 0.28, 0.85);
  // A drop under the point, and the cord with its beads.
  dots.push([["o", x, y - h / 2 + 0.9, 0.9]]);
  const top = cy + hh * 0.96;
  if (cord > 0) {
    pt.stroke(G.polyline([[x, top], [x, top + cord]], false), PAL.gold, 0.25, 0.8);
    const beads = rng.int(1, 3);
    for (let k = 1; k <= beads; k++) dots.push([["o", x, top + (cord * k) / (beads + 1), 0.75]]);
  }
  pt.fillMany(dots, PAL.gold, 0.9);
  pt.groupEnd();
  return [shape, kn];
}
