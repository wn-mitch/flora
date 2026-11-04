// Leaves: a blade grown around a curved midrib, painted as a watercolour
// wash with one lit half and white veins.
import { mod } from "#platform";
import * as Brush from "./brush.ts";
import * as C from "./color.ts";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";
import { COMPOSE, LAYING, PLANT, WASH } from "./tune.ts";
import * as W from "./wash.ts";

const PI = Math.PI;

export type Margin = "entire" | "serrate" | "acanthus" | "feather";

// Tooth spacing and depth noise for one side of a blade.
interface Jitter {
  readonly phase: (this: void, x: number) => number;
  readonly depth: (this: void, x: number) => number;
}

// Margin multiplier at fraction t. Serrate teeth lean toward the tip
// because the width rises slowly through each period and drops sharply at
// its end. Acanthus lobes (`teeth` of them along a side) swell to a rounded
// shoulder past their middle, so they sweep toward the tip, with curved
// recesses between. `jit` perturbs tooth spacing and depth so no two teeth
// match.
export function margin(kind: Margin, t: number, teeth: number, depth: number, jit?: Jitter): number {
  const fade = G.smoothstep(0.12, 0.28, t) * (1 - G.smoothstep(0.86, 1, t));
  if (jit !== undefined) {
    depth = depth * (0.7 + (0.5 * (jit.depth(t * teeth) + 1)) / 2);
    t = t + (0.3 * jit.phase(t * teeth * 0.7)) / Math.max(teeth, 1);
  }
  const u = t * teeth;
  const f = u - Math.floor(u);
  if (kind === "serrate") return 1 - depth * fade * (1 - f ** 1.7);
  if (kind === "acanthus") {
    // Each lobe rises from its recess to a broad, rounded shoulder at 62%
    // of its length, then rolls over and sweeps down toward the tip into
    // the next recess.
    const c = 0.62;
    const crest = f < c ? Math.sin(((PI / 2) * f) / c) ** 0.8 : 1 - ((f - c) / (1 - c)) ** 1.6;
    return 1 - fade * depth * (1 - crest);
  }
  if (kind === "feather") {
    // A feather lobe swells from its recess, narrows to a soft tip at 78%
    // of its length and drops back; the outline's sweep then leans each
    // lobe toward the leaf's tip.
    const c = 0.78;
    const crest = f < c ? Math.sin(((PI / 2) * f) / c) ** 1.3 : 1 - ((f - c) / (1 - c)) ** 0.9;
    return 1 - fade * depth * (1 - crest);
  }
  return 1;
}

// Blade half-width at fraction t, as a share of the widest: a short stalk
// (STALK of the length), a tapering wedge-shaped base, the widest point
// about two fifths of the way up, and a narrowing tip.
const STALK = 0.07;
export function blade(t: number, kp: number, ep: number): number {
  const u = Math.max(0, (t - STALK) / (1 - STALK));
  return 0.035 + 0.965 * Math.sin(PI * u ** kp) ** ep * G.smoothstep(0, 0.32, u) ** 0.6;
}

export interface LeafOptions {
  len: number;
  width: number;
  bend: number;               // radians over the length
  hook: number;               // tip curl
  margin: Margin;
  shape: "ovate" | "lance";
  look: string;               // "vivid", "deep" or "soft"
  veins: number;
  lightning: boolean;         // forked veinlets
  teeth?: number;
  depth?: number;
  sides?: "both" | "left" | "right";
  inner?: number;             // lobe depth on the side `sides` leaves out, share of depth
  sweep?: number;             // radians each lobe leans toward the tip at its crest
  striate?: boolean;          // a feather's fine veins
  attach?: Attachment;
}

// Half-width at fraction t of a leaf with options o, as a share of o.width,
// before its margin is cut.
export function profile(o: LeafOptions, t: number): number {
  return o.shape === "lance" ? blade(t, 0.55, 1.05) : blade(t, 0.68, 0.85);
}

// Outline and midrib in local coordinates: base at the origin, heading +y.
// Returns the outline, the midrib and the left and right margins.
export function outline(rng: Rng, o: LeafOptions): [Pt[], Pt[], Pt[], Pt[]] {
  // Swept lobes need finer sampling: each drops back into its recess over
  // about a fifth of its length.
  const teeth = o.teeth ?? 0;
  const n = Math.max(48, teeth * (o.sweep !== undefined ? 16 : 7));
  const spine = G.curve([0, 0], PI / 2, o.len, o.bend, o.hook, n);
  const nz = G.fbm(rng, 32);
  const jl: Jitter = { phase: G.noise(rng, 32), depth: G.noise(rng, 32) };
  const jr: Jitter = { phase: G.noise(rng, 32), depth: G.noise(rng, 32) };
  const al = 1 + rng.jit(0.12), ar = 1 + rng.jit(0.12);
  const left: Pt[] = [], right: Pt[] = [];
  const m = spine.length;
  const side = o.sides ?? "both";
  const depth = o.depth ?? 0;
  const dl = side !== "right" ? depth : depth * (o.inner ?? 0);
  const dr = side !== "left" ? depth : depth * (o.inner ?? 0);
  const sweep = o.sweep ?? 0;
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1);
    const nrm = G.angle(spine[Math.max(i - 1, 0)], spine[Math.min(i + 1, m - 1)]) + PI / 2;
    const pr = profile(o, t);
    const w = o.width * pr * (1 + 0.06 * nz(t * 6));
    const ml = margin(o.margin, t, teeth, dl, jl);
    // The right side's teeth or lobes sit half a period up from the left's.
    const mr = margin(o.margin, t + 0.5 / Math.max(teeth, 1), teeth, dr, jr);
    // Swept lobes: on a lobed side, the further a point stands from the
    // midrib, the more its direction leans toward the tip. The lean grows
    // in proportion to that distance, so the side never folds back over
    // itself while sweep * tan(sweep) < 1 (sweep below about 0.86).
    const sl = dl > 0 ? sweep * Math.min(al * ml * pr, 1) : 0;
    const sr = dr > 0 ? sweep * Math.min(ar * mr * pr, 1) : 0;
    left.push(G.polar(spine[i], nrm - sl, w * al * ml));
    right.push(G.polar(spine[i], nrm + PI + sr, w * ar * mr));
  }
  const out = left.slice();
  for (let i = right.length - 2; i >= 1; i--) out.push(right[i]);
  return [out, spine, left, right];
}

const LOOKS: Readonly<Record<string, { pigment: RGB; pool: RGB; strength: number }>> = {
  vivid: { pigment: PAL.blue, pool: PAL.deep, strength: 1.0 },
  deep: { pigment: PAL.deep, pool: PAL.ink, strength: 1.0 },
  soft: { pigment: PAL.sky, pool: PAL.deep, strength: 0.95 },
};

// Veins: a white midrib, lateral veins leaning toward the tip, optional
// forked "lightning" veinlets and engraved hatching from the margin. Points
// are in page coordinates. Indices into the midrib follow the Lua
// original's, from 1.
function veins(pt: Painter, rng: Rng, spine: readonly Pt[], left: readonly Pt[], right: readonly Pt[], size: number, o: LeafOptions): void {
  const n = spine.length;
  const S = (i: number) => spine[i - 1];
  const mid: Pt[] = [];
  for (let i = Math.max(2, Math.floor(n * 0.03)); i <= Math.floor(n * 0.93); i++) mid.push(S(i));
  // Veins are broken and vary in contrast, so they sit in the wash rather
  // than reading as crisp lines drawn over it.
  const cfg = WASH;
  // Each line is penned on its own, the k-th of n starting `at(k, n)` pt
  // of growth into the leaf's painting.
  const broken = (lines: readonly Pt[][], w: number, gap: number, lo: number, hi: number, at: (k: number, n: number) => number) => {
    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      pt.lay([{ start: at(k, lines.length), dur: LAYING.vein * size, along: line, half: w + 1 }], () => {
        const pieces = Brush.broken(rng, line, w, gap, cfg.brush_dry * 0.5);
        if (pieces.length > 0) pt.fillMany(pieces.map((p) => Brush.polygon(p)), PAL.white, rng.range(lo, hi));
      });
    }
  };
  // Laterals pair off along the midrib, left and right together.
  const vein = (k: number, n: number) => (LAYING.veins[0] + (LAYING.veins[1] * Math.floor(k / 2)) / Math.max(1, Math.ceil(n / 2))) * size;
  const ribLay = [{ start: LAYING.midrib[0] * size, dur: LAYING.midrib[1] * size, along: mid, half: size * 0.03 + 1 }];
  pt.lay(ribLay, () => {
    for (const line of [mid]) {
      const pieces = Brush.broken(rng, line, size * 0.03, 0.08, cfg.brush_dry * 0.5);
      if (pieces.length > 0) pt.fillMany(pieces.map((p) => Brush.polygon(p)), PAL.white, rng.range(0.5, 0.75));
    }
  });
  const lineInk = C.recolor(PAL.ink, C.partInk("leaves", pt.palette));
  pt.lay(ribLay, () => {
    W.hairlines(pt, [G.transform(mid, size * 0.012, -size * 0.004, 0)], lineInk, size * 0.006, 0.35, { blend: "multiply", head: 0.02 });
  });

  const lats: Pt[][] = [], forks: Pt[][] = [];
  if (o.striate === true) {
    // A feather's veins are fine pale lines, about three to a lobe, each
    // running from the midrib out along a lobe toward its tip.
    const fine: Pt[][] = [];
    const count = (o.teeth ?? 6) * 3;
    for (const edge of [left, right]) {
      for (let k = 1; k <= count; k++) {
        const t = 0.1 + (0.82 * (k - 0.5)) / count + rng.jit(0.01);
        const i = G.clamp(Math.floor(t * (n - 1)) + 1, 2, n - 1);
        const p0 = S(i), tip = edge[Math.min(i + Math.floor(n * 0.05), n) - 1];
        const p1 = G.mix(p0, tip, rng.range(0.6, 0.88));
        const m = G.mix(G.mix(p0, p1, 0.5), S(Math.min(i + Math.floor(n * 0.03), n)), 0.2);
        fine.push(G.splinePoints([p0, m, p1], 5));
      }
    }
    broken(fine, size * 0.009, cfg.brush_gap, cfg.vein_contrast[0], cfg.vein_contrast[1], vein);
  }
  const count = o.striate === true ? 0 : o.veins;
  for (let k = 1; k <= count; k++) {
    const t = 0.10 + (0.78 * (k - 0.5)) / count + rng.jit(0.03);
    const i = G.clamp(Math.floor(t * (n - 1)) + 1, 2, n - 1);
    for (const edge of [left, right]) {
      const p0 = S(i), tip = edge[Math.min(i + Math.floor(n * 0.08), n) - 1];
      const p1 = G.mix(p0, tip, rng.range(0.72, 0.9));
      const m = G.mix(G.mix(p0, p1, 0.5), S(Math.min(i + Math.floor(n * 0.05), n)), 0.25);
      const line = G.splinePoints([p0, m, p1], 5);
      lats.push(line);
      if (o.lightning && rng.chance(0.8)) {
        const [q, ang] = G.at(line, rng.range(0.4, 0.7));
        forks.push(G.curve(q, ang + rng.jit(0.7), G.dist(p0, p1) * 0.4, rng.jit(0.5), 0, 6));
      }
    }
  }
  broken(lats, size * 0.02, cfg.brush_gap, cfg.vein_contrast[0], cfg.vein_contrast[1], vein);
  // A fork follows the vein it leaves.
  if (forks.length > 0) broken(forks, size * 0.012, cfg.brush_gap, cfg.vein_contrast[0] * 0.7, cfg.vein_contrast[1] * 0.7, (k, n) => vein(k, n) + LAYING.vein * size);

  // Engraved hatching: short dark strokes running in from the margin,
  // slanted toward the base like the veins they shadow.
  const hatch: Pt[][] = [];
  const back = Math.max(1, Math.floor(n * 0.06));
  for (const edge of [left, right]) {
    for (let i = Math.floor(n * 0.08); i <= Math.floor(n * 0.92); i += 2) {
      const m = edge[i - 1];
      hatch.push([m, G.mix(m, S(Math.max(1, i - back)), rng.range(0.18, 0.38))]);
    }
  }
  pt.lay([{ start: LAYING.hatch[0] * size, dur: LAYING.hatch[1] * size, along: spine, half: reachFrom(spine, left.concat(right)) + 2 }], () => {
    W.hairlines(pt, hatch, lineInk, size * 0.007, 0.32, { blend: "multiply", head: 0.01 });
  });
}

// How far any of `pts` lies from polyline `line`'s nearest vertex.
export function reachFrom(line: readonly Pt[], pts: readonly Pt[]): number {
  let far = 0;
  for (const p of pts) {
    let near = Infinity;
    for (const q of line) near = Math.min(near, G.dist(p, q));
    far = Math.max(far, near);
  }
  return far;
}

// Options for a large leaf of length up to `len` heading `ang`, drawn from
// stream `r`. Kinds follow the reference: most large leaves are feathers
// (long, arching, lobes swept toward the tip, mostly on the outer curve), a
// few are broad acanthus leaves lobed on both sides, and the rest are
// smooth lance leaves; `factor` (Painter.factor) weighs each shape by the
// page's mix. Small leaves are always lance leaves. Lobed leaves mix deep
// and light lobing.
export function options(r: Rng, len: number, ang: number, factor: (kind: string) => number = () => 1): LeafOptions {
  const up = Math.cos(ang) < 0 ? -1 : 1;
  let kind = r.weighted({ feather: 6 * factor("feather"), acanthus: 1.5 * factor("acanthus"), lance: 2.5 * factor("lance") }) ?? "lance";
  if (len < 45) kind = "lance";
  // Half the leaves arch over: the blade bends up and the tip droops.
  const droop = r.chance(0.5);
  const deep = r.chance(0.5);
  const o: LeafOptions = {
    len: len * r.range(0.85, 1.0), width: len * r.range(COMPOSE.leaf_width[0], COMPOSE.leaf_width[1]),
    bend: up * r.range(0.6, 1.3), hook: (droop ? -up : up) * r.range(0.5, 1.4),
    margin: kind === "feather" ? "feather" : kind === "acanthus" ? "acanthus" : "entire",
    shape: "lance",
    look: r.weighted({ vivid: 3, soft: 2 }) ?? "vivid",
    veins: r.int(5, 7), lightning: r.chance(0.25),
  };
  if (kind === "acanthus") {
    // Three to six broad lobes a side, on both sides.
    o.teeth = r.int(3, 6);
    o.depth = deep ? r.range(0.5, 0.72) : r.range(0.18, 0.32);
    o.sides = "both";
    o.width = o.width * 1.25;
  } else if (kind === "feather") {
    // Five to eight narrow lobes a side, swept toward the tip, on the outer
    // side of the arch; the inner side is lobed lightly or not at all. A
    // feather arches further than other leaves.
    o.teeth = r.int(5, 8);
    o.depth = deep ? r.range(0.6, 0.82) : r.range(0.32, 0.45);
    o.sides = up > 0 ? "right" : "left";
    o.inner = r.chance(0.6) ? r.range(0.2, 0.45) : 0;
    o.sweep = r.range(0.5, 0.75);
    o.bend = o.bend * 1.25;
    o.width = o.width * 0.85;
    o.striate = true;
  } else {
    // Lance leaves are narrow and bend gently; some curl their tip over.
    o.width = o.width * 0.75;
    o.bend = o.bend * 0.5;
    o.hook = r.chance(0.3) ? o.hook * 1.6 : o.hook * 0.6;
  }
  return o;
}

// The stretches of outline `poly` a leaf's halo follows: all of it but the
// part within 0.18 `size` of `base`.
export function haloRuns(poly: readonly Pt[], base: Pt, size: number): Pt[][] {
  const n = poly.length;
  let i0 = 0, best = Infinity;
  poly.forEach((p, i) => {
    const d = G.dist(p, base);
    if (d < best) {
      i0 = i;
      best = d;
    }
  });
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let j = 0; j < n; j++) {
    const p = poly[mod(i0 + j, n)];
    if (G.dist(p, base) > size * 0.18) {
      run.push(p);
    } else {
      if (run.length >= 3) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 3) runs.push(run);
  return runs;
}

// A soft paper-white halo just outside a blade's edge. On bare paper it
// does not show; where the blade lies over a stem, a spray or another leaf,
// it lifts what is beneath along the edge, so the blade reads as in front.
// It is left off near the base, which joins its stem (attach).
function halo(pt: Painter, poly: readonly Pt[], base: Pt, size: number): void {
  const runs = haloRuns(poly, base, size).map((run) => G.smooth(run, false));
  if (runs.length === 0) return;
  for (const w of [3.4, 2.2, 1.2]) pt.strokeMany(runs, PAL.paper, w, 0.2);
}

// Where a leaf joins its stem: f, where it joins around the stem (1 on the
// side facing the viewer, -1 behind it, 0 at its silhouette); p, the stem's
// centre at the node; seg, the stem's centreline near the node; w, the
// stem's width there.
export interface Attachment {
  readonly f: number;
  readonly p: Pt;
  readonly seg: readonly Pt[];
  readonly w: number;
}

// Paint a leaf whose base sits at (x, y), pointing along `ang`. Returns the
// midrib in page coordinates.
export function leaf(pt: Painter, rng: Rng, x: number, y: number, ang: number, o: LeafOptions): Pt[] {
  const [localPts, localSpine, localLeft, localRight] = outline(rng, o);
  const rot = ang - PI / 2;
  const poly = G.transform(localPts, x, y, rot);
  const spine = G.transform(localSpine, x, y, rot);
  const left = G.transform(localLeft, x, y, rot);
  const right = G.transform(localRight, x, y, rot);
  const look = LOOKS[o.look] ?? LOOKS.vivid;
  const size = o.len;

  // The lit half: the midrib plus the right-hand margin.
  const lit = spine.slice();
  for (let i = right.length - 1; i >= 0; i--) lit.push(right[i]);

  // The wash floods the blade from its base to its tip, the halo and the
  // joint with it.
  const half = reachFrom(spine, poly) + 4;
  const body = [{ along: spine, half, dur: LAYING.leaf_wash * size, wet: LAYING.leaf_wet * size }];
  pt.lay(body, () => halo(pt, poly, spine[0], size));
  W.wash(pt, poly, {
    rng, size,
    sweep: { along: spine, half, body: LAYING.leaf_wash * size, wet: LAYING.leaf_wet * size, line: [LAYING.outline[0] * size, LAYING.outline[1] * size] },
    ramp: o.look === "soft" ? "soft" : "leaf", axis: [spine[0], spine[spine.length - 1]],
    light: G.at(spine, 0.25)[0],
    pigment: look.pigment, pool: look.pool, strength: look.strength,
    rings: 8, lift: 0.035, bleed: o.width * 0.05,
    dark_streaks: 0, streaks: 0,
    // A leaf reads as solid colour with pale veins, not a streaked petal.
    pale_scale: 0.2, lifts: 0.5, fade_scale: 0.5,
    // Brushwork runs along the blade, between the midrib and either edge.
    brush_lines: (r, n) => {
      const lines: Pt[][] = [];
      for (let k = 0; k < n; k++) {
        const edge = r.chance(0.5) ? left : right, s = r.range(0.15, 0.85);
        lines.push(spine.map((p, i) => G.mix(p, edge[Math.min(i, edge.length - 1)], s)));
      }
      return lines;
    },
    grain: 0.45, grain_scale: 0.9,
    outline: 0.85, outline_w: Math.max(0.28, size * 0.008),
    inner: (p) => {
      p.fill(G.smooth(lit, true), PAL.white, 0.08);
      veins(p, rng, spine, left, right, size, o);
    },
  });
  const at = o.attach;
  if (at !== undefined) pt.lay(body, () => attach(pt, poly, spine, size, at));
  return spine;
}

// How far in front a joint must be to carry the stem on into the midrib.
export const FRONT = 0.35;

// Blend a leaf's base into the stem it grows from, as the joint would look
// in perspective. Every joint glazes the stem's colour into the pale base.
// In front, a stalk carries the stem on into the midrib; behind, the stem
// passes over the base and casts a faint shadow on it; at the silhouette,
// the leaf stands off the stem's edge on a short stalk. Where the blade
// crosses the stem, the stem shows through by how far in front the blade
// is.
export function attach(pt: Painter, poly: readonly Pt[], spine: readonly Pt[], size: number, at: Attachment): void {
  const tone = Brush.stemTone(pt, PLANT);
  const base = spine[0];
  const body = G.smooth(poly, true);
  if (Math.abs(at.f) < FRONT) {
    // The stalk leaves the stem's edge in its colour and pales as it runs
    // into the blade's own stalk: overlapping strokes, each reaching less
    // far from the stem.
    const from = G.mix(at.p, base, at.w / 2 / Math.max(1e-9, G.dist(at.p, base)));
    const to = G.polar(base, G.angle(spine[0], spine[1]), 3);
    for (let k = 1; k <= 4; k++) {
      const line = G.resample([from, G.mix(from, to, k / 4)], 6);
      pt.fill(G.smooth(G.ribbon(line, (t) => at.w * (0.3 - (0.1 * t * k) / 4)), true), tone, 0.22, { blend: "multiply" });
    }
  }
  pt.clipBegin(body);
  const reach = size * (at.f > FRONT ? 0.24 : 0.16);
  for (let k = 1; k <= 6; k++) pt.fill([["o", base[0], base[1], reach * (1 - (k - 1) / 6)]], tone, 0.08, { blend: "multiply" });
  if (at.f > FRONT) {
    const rib: Pt[] = [];
    for (const p of spine) {
      rib.push(p);
      if (G.length(rib) > size * 0.22) {
        rib.pop();
        break;
      }
    }
    if (rib.length >= 2) pt.fill(G.smooth(W.taper(rib, at.w * 0.85, 0.001), true), tone, 0.55, { blend: "multiply" });
  }
  // Where the blade crosses the stem, the stem shows through it: faintly
  // through a blade in front, more at the silhouette, and over a blade
  // behind it, which it shades.
  if (at.seg.length >= 2) {
    const band = (k: number) => G.smooth(G.ribbon(at.seg, () => (at.w * k) / 2), true);
    if (at.f < -FRONT) {
      pt.fill(band(2.6), C.recolor(PAL.deep, C.partInk("leaves", pt.palette)), 0.14, { blend: "multiply" });
      pt.fill(band(1), tone, 0.6);
    } else {
      pt.fill(band(1), tone, G.clamp(0.45 - 0.35 * at.f, 0.15, 0.45), { blend: "multiply" });
    }
  }
  pt.clipEnd();
}

// A small leaflet: its base at (x, y), heading `ang`, `len` pt long.
export type Leaflet = readonly [number, number, number, number];

// Small leaflets along stems. Each has the large leaves' blade: a stalk, a
// tapering base and a pointed tip, with a slight bend and an uneven edge.
// Leaflets are painted like the leaves (a base-to-tip ramp, granulation, a
// partly lost edge and a pale midrib), scaled to their size; given `rgb`,
// they are batched flat fills instead (a flower's sepals).
export function leaflets(pt: Painter, rng: Rng, items: readonly Leaflet[], rgb?: RGB, opacity = 0.88): void {
  const bodies: Cmd[][] = [], ribs: Cmd[][] = [];
  for (const [x, y, ang, len] of items) {
    const pts: Pt[] = [];
    const bend = rng.jit(0.35);
    const wd = len * rng.range(0.17, 0.23);
    const kp = rng.range(0.62, 0.74), ep = rng.range(0.8, 0.95);
    const al = 1 + rng.jit(0.12), ar = 1 + rng.jit(0.12);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push([-wd * al * blade(t, kp, ep) + bend * len * t * t, len * t]);
    }
    for (let i = 15; i >= 1; i--) {
      const t = i / 16;
      pts.push([wd * ar * blade(t, kp, ep) + bend * len * t * t, len * t]);
    }
    const rot = ang - PI / 2;
    const poly = G.transform(pts, x, y, rot);
    const rib = G.transform([[0, len * 0.12], [bend * len * 0.25, len * 0.7]], x, y, rot);
    if (rgb === undefined) {
      const tip = G.transform([[bend * len, len]], x, y, rot)[0];
      const axis: Pt[] = [[x, y], G.mix([x, y], tip, 0.5), tip];
      // Each leaflet is painted once the front reaches its base.
      pt.lay([{ at: [x, y] }], () => W.wash(pt, poly, {
        rng, size: len,
        sweep: { along: axis, half: reachFrom(axis, poly) + 2, body: LAYING.leaf_wash * len, wet: LAYING.leaf_wet * len, line: [LAYING.outline[0] * len, LAYING.outline[1] * len] },
        ramp: "leaf", part: "leaflets", axis: [[x, y], tip], light: G.mix([x, y], tip, 0.3),
        pigment: PAL.blue, pool: PAL.deep, strength: 1.1,
        rings: 4, lift: 0.02, bleed: len * 0.03,
        dark_streaks: 0, streaks: 0, fade_scale: 0.5, simple: true, grain: 0.5, grain_scale: 0.5,
        outline: 0.75, outline_w: Math.max(0.2, len * 0.012),
        inner: (p) => p.stroke(G.polyline(rib, false), PAL.white, Math.max(0.18, len * 0.03), 0.55),
      }));
    } else {
      bodies.push(G.smooth(poly, true));
      ribs.push(G.polyline(rib, false));
    }
  }
  if (rgb !== undefined && bodies.length > 0) {
    pt.fillMany(bodies, rgb, opacity, { blend: "multiply" });
    pt.strokeMany(ribs, PAL.white, 0.18, 0.45);
  }
}
