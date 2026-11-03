// Flowers: parametric petals, frontal blooms, tilted blooms and tiny florets.
import { fmt } from "#platform";
import * as C from "./color.ts";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import { leaflets, type Leaflet } from "./leaf.ts";
import { PAL, type Painter, type Projection } from "./paint.ts";
import type { Rng } from "./rng.ts";
import { BLOOMS, HERO } from "./tune.ts";
import * as W from "./wash.ts";

const PI = Math.PI;

// Petal silhouettes. Half-width at fraction t of the length is
//   W * sin(pi * t^k)^e * smoothstep(0, claw, t)^0.7
// so k moves the widest point toward the tip and e < 1 rounds the tip.
// A wedge petal instead has a narrow claw at the eye whose sides curve out
// (concave, then convex; `rise` > 1 pinches the claw) to the shoulder at
// `shoulder` of the length, then a broad rounded end with a wavy, slightly
// scalloped rim (the reference's hero petals).
interface Curved {
  readonly wedge?: undefined;
  readonly k: number;
  readonly e: number;
  readonly claw: number;
  readonly notch: number;
  readonly wave: number;
  readonly freq: number;
}
interface Wedge {
  readonly wedge: true;
  readonly shoulder: number;
  readonly base: number;
  readonly rise: number;
  readonly notch: number;
  readonly wave: number;
  readonly scallop: number;
  readonly freq: number;
}
export type PetalKind = Curved | Wedge;

export const KINDS: Readonly<Record<string, PetalKind>> = {
  obovate: { k: 0.72, e: 0.60, claw: 0.46, notch: 0.10, wave: 0.11, freq: 5 },
  lance: { k: 1.15, e: 1.30, claw: 0.10, notch: 0.00, wave: 0.05, freq: 3 },
  round: { k: 0.95, e: 0.50, claw: 0.20, notch: 0.05, wave: 0.07, freq: 3 },
  ghost: { k: 0.85, e: 0.60, claw: 0.20, notch: 0.06, wave: 0.14, freq: 4 },
  // The reference's flower: widest close to a broad, rounded end.
  fan: { k: 0.56, e: 0.42, claw: 0.50, notch: 0.04, wave: 0.16, freq: 6 },
  wedge: { wedge: true, shoulder: 0.74, base: 0.06, rise: 1.3, notch: 0.03, wave: 0.12, scallop: 0.035, freq: 6 },
};

// Half-width at fraction t of the length, as a share of the petal's
// maximum half-width.
function profile(K: PetalKind, t: number): number {
  if (K.wedge === true) {
    if (t <= K.shoulder) return K.base + (1 - K.base) * Math.sin(((PI / 2) * t) / K.shoulder) ** K.rise;
    const u = (t - K.shoulder) / (1 - K.shoulder);
    return Math.sqrt(Math.max(0, 1 - u * u));
  }
  return Math.sin(PI * t ** K.k) ** K.e * G.smoothstep(0, K.claw, t) ** 0.7;
}

// Petal outline in local coordinates: base at the origin, tip toward +y.
// `wave` overrides the kind's rim waviness. With `slot`, the half-width at
// distance d from the base never exceeds slot * d, so petals radiating
// from one eye with slot = tan(pi / n) * (1 - gap) keep a gap of at least
// `gap` of their sector between them.
export function petal(rng: Rng, kind: string, L: number, Wd: number, bend = 0, wave?: number, slot?: number): Pt[] {
  const K = KINDS[kind];
  const n = 26;
  const nl = G.fbm(rng, 32), nr = G.fbm(rng, 32);
  const al = 1 + rng.jit(0.12), ar = 1 + rng.jit(0.12);
  const wv = wave ?? K.wave;
  if (slot !== undefined) {
    // Shrink the whole petal until its (wobbled) outline fits the sector,
    // so its curves survive; the clamp below only catches what is left.
    let fit = 1;
    for (let i = 4; i <= 20; i++) {
      const t = i / 20;
      const need = Wd * profile(K, t) * Math.max(al, ar) * (1 + wv * t ** 1.5);
      fit = Math.min(fit, (slot * L * t * (1 - K.notch)) / Math.max(need, 1e-9));
    }
    Wd = Wd * fit;
  }
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = Wd * profile(K, t);
    const y = L * t - K.notch * L * Math.exp(-(((1 - t) / 0.045) ** 2));
    const wobble = wv * t ** 1.5;
    const bx = bend * L * t * t;
    let wl = w * al * (1 + wobble * nl(t * K.freq * 3)), wr = w * ar * (1 + wobble * nr(t * K.freq * 3));
    let yl = y, yr = y;
    if (K.wedge === true && t > K.shoulder) {
      // The rounded end ripples along its length as well as across it.
      const s = G.smoothstep(K.shoulder, 1, t) * K.scallop * L;
      yl = y + s * nl(7 + t * K.freq * 2);
      yr = y + s * nr(7 + t * K.freq * 2);
    }
    if (slot !== undefined) {
      const cap = slot * Math.max(0, Math.min(yl, yr));
      // Both edges stay within +-cap of the petal's axis, wherever the bend
      // puts the centre.
      wl = Math.max(0, Math.min(wl, cap + bx));
      wr = Math.max(0, Math.min(wr, cap - bx));
    }
    left.push([bx - wl, yl]);
    right.push([bx + wr, yr]);
  }
  const out = left.slice();
  for (let i = right.length - 2; i >= 1; i--) out.push(right[i]);
  return out;
}

const ROSE: RGB = [0.72, 0.36, 0.40];
const PISTIL: RGB = [0.55, 0.26, 0.22];

// n points on a circle of radius r around c.
function circle(c: Pt, r: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const t = (k * 2 * PI) / n;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

export interface EyeOptions {
  readonly halo?: number;    // radius of the white glow, as a share of R
  readonly stamens?: number; // how many stamens
}

// The eye of a bloom of radius R: a soft, uneven white glow, a faint rose
// flush, stamens and a small pistil. The glow is a stack of deformed blots,
// so it has no ring edges. Stamens leave at uneven angles on slightly
// curved, tapering filaments of mixed length, each tipped with a small
// anther drawn along its filament in a warm tone that varies from stamen to
// stamen. Loose pollen dots sit near the pistil, which is a rose-brown disc
// with a darker rim and a highlight.
export function eye(pt: Painter, rng: Rng, cx: number, cy: number, R: number, o: EyeOptions = {}): void {
  const c: Pt = [cx, cy];
  const halo = o.halo ?? 0.36;
  const glow: Cmd[][] = [];
  for (let k = 1; k <= 6; k++) {
    const r = R * halo * (1 - (k - 1) / 7);
    glow.push(G.smooth(G.deform(circle(G.polar(c, rng.range(0, 2 * PI), R * 0.012), r, 18), rng, r * 0.12), true));
  }
  for (const b of glow) pt.fill(b, PAL.white, 0.18);
  // The flush deepens toward the pistil through faint stacked blots.
  for (let k = 1; k <= 4; k++) {
    const r = R * (0.14 - 0.022 * k);
    pt.fill(G.smooth(G.deform(circle(c, r, 16), rng, r * 0.2), true), ROSE, 0.08, { blend: "multiply" });
  }

  const m = o.stamens ?? 14;
  const fil: Pt[][] = [], anthers: Pt[][] = [], warm: number[] = [], pollen: Cmd[][] = [];
  const a0 = rng.range(0, 2 * PI);
  for (let i = 0; i < m; i++) {
    const a = a0 + ((i + rng.jit(0.35)) * 2 * PI) / m;
    const len = R * rng.range(0.10, 0.21);
    const p0 = G.polar(c, a, R * 0.035);
    const line = G.curve(p0, a + rng.jit(0.12), len, rng.jit(0.6), 0, 6);
    fil.push(line);
    const tip = line[line.length - 1], ta = G.angle(line[line.length - 2], tip);
    const ar = R * rng.range(0.007, 0.011);
    const anther = G.transform(circle([0, 0], 1, 10), 0, 0, 0, ar * 1.5, ar);
    anthers.push(G.transform(anther, tip[0], tip[1], ta));
    warm.push(rng.range(0, 1));
  }
  for (let i = 0; i < Math.floor(m * 0.6); i++) {
    const q = G.polar(c, rng.range(0, 2 * PI), R * rng.range(0.05, 0.13));
    pollen.push([["o", q[0], q[1], R * rng.range(0.004, 0.008)]]);
  }
  // Filaments are fine and faint: the stamens read by their tips.
  W.hairlines(pt, fil, PAL.ink, Math.max(0.12, R * 0.0035), 0.32, { head: 0.3, blend: "multiply" });
  // Anthers in two warm tones: copper and a rosier brown.
  const a1: Cmd[][] = [], a2: Cmd[][] = [];
  for (let i = 0; i < anthers.length; i++) (warm[i] < 0.6 ? a1 : a2).push(G.smooth(anthers[i], true));
  if (a1.length > 0) pt.fillMany(a1, PAL.copper, 0.85);
  if (a2.length > 0) pt.fillMany(a2, ROSE, 0.8);
  if (pollen.length > 0) pt.fillMany(pollen, PAL.copper, 0.55);
  const disc = G.smooth(G.deform(circle(c, R * 0.032, 12), rng, R * 0.005), true);
  pt.fill(disc, PISTIL, 0.95);
  pt.stroke(disc, PAL.ink, Math.max(0.12, R * 0.004), 0.45);
  pt.fill([["o", cx - R * 0.009, cy + R * 0.009, R * 0.010]], PAL.white, 0.35);
}

// Wash settings by look. `strength` scales pigment load.
interface PetalLook {
  readonly ramp: string;
  readonly pigment: RGB;
  readonly pool: RGB;
  readonly strength: number;
  readonly rings: number;
  readonly lift: number;
  readonly streaks: number;
  readonly dark: number;
  readonly grain: number;
  readonly outline: number;
  readonly knockout?: number;
}
export const LOOKS: Readonly<Record<string, PetalLook>> = {
  vivid: { ramp: "vivid", pigment: PAL.blue, pool: PAL.deep, strength: 1.15, rings: 12, lift: 0.05, streaks: 40, dark: 22, grain: 0.9, outline: 0.55 },
  fan: { ramp: "fan", pigment: PAL.blue, pool: PAL.deep, strength: 1.15, rings: 12, lift: 0.05, streaks: 40, dark: 16, grain: 2.0, outline: 0.5 },
  hero: { ramp: "hero", pigment: PAL.blue, pool: PAL.deep, strength: 1.15, rings: 12, lift: 0.05, streaks: 40, dark: 22, grain: 2.0, outline: 0.55 },
  soft: { ramp: "soft", pigment: PAL.sky, pool: PAL.deep, strength: 0.95, rings: 10, lift: 0.07, streaks: 22, dark: 12, grain: 0.6, outline: 0.70 },
  ghost: { ramp: "ghost", pigment: PAL.mist, pool: PAL.sky, strength: 0.45, rings: 8, lift: 0.12, streaks: 8, dark: 3, grain: 0.15, outline: 0.45, knockout: 0.35 },
};

// The petal's tip: the outline point farthest from the flower's eye.
function tipOf(poly: readonly Pt[], from: Pt): Pt {
  let best = poly[0], bd = -1;
  for (const p of poly) {
    const d = G.dist(p, from);
    if (d > bd) {
      best = p;
      bd = d;
    }
  }
  return best;
}

interface Extra {
  veins?: number;
  rays?: { readonly count: number; readonly reach: readonly [number, number]; readonly contrast: readonly [number, number] };
  eye_fade?: number;
  lifts?: number;
}

function washPetal(pt: Painter, rng: Rng, poly: readonly Pt[], L: number, light: Pt, look: PetalLook, lost?: number, extra: Extra = {}): void {
  W.wash(pt, poly, {
    ramp: look.ramp, axis: [light, tipOf(poly, light)],
    rng, size: L, light,
    pigment: look.pigment, pool: look.pool, strength: look.strength,
    rings: look.rings, lift: look.lift, bleed: Math.min(L * 0.02, 1.6),
    streaks: Math.floor(look.streaks * G.clamp(L / 40, 0.35, 1.4)),
    dark_streaks: extra.veins ?? look.dark, grain: look.grain, rays: extra.rays,
    outline: look.outline, outline_w: Math.max(0.25, L * 0.009),
    knockout: look.knockout, lost,
    eye_fade: extra.eye_fade, lifts: extra.lifts,
  });
}

// Bloom styles (tune.ts BLOOMS): each names a petal kind and a colour look
// and carries its own ranges, so blooms of one style still differ.
export const STYLES: Readonly<Record<string, { readonly kind: string; readonly look: string }>> = {
  fan: { kind: "fan", look: "fan" },
  round: { kind: "round", look: "vivid" },
  soft: { kind: "round", look: "soft" },
  obovate: { kind: "obovate", look: "vivid" },
  wedge: { kind: "wedge", look: "vivid" },
};

// One of `names` (bloom styles), picked by their BLOOMS weights times the
// painter's mix weight for the style.
export function pickStyle(pt: Painter, rng: Rng, names: readonly string[]): string {
  const w: Record<string, number> = {};
  let total = 0;
  for (const n of names) {
    w[n] = Math.max(0, BLOOMS[n].weight) * pt.factor(n);
    total += w[n];
  }
  if (total <= 0) return names[0];
  return rng.weighted(w) ?? names[0];
}

// The half-width limit per unit of length (petal's `slot`) for n petals
// that may each turn up to `spacing` radians toward a neighbour: petals
// fill what is left of their sector after the turn, less `gap` of it, so
// neighbours stay apart however the jitter falls.
export function slot(n: number, gap: number, spacing: number): number {
  return Math.tan(Math.max(0.05, PI / n - spacing)) * (1 - gap);
}

export interface BloomOptions {
  // A bloom style (tune.ts BLOOMS): sets the petal kind, look, count,
  // width, rim, rays and veins, each drawn per bloom. The rest override it.
  readonly style?: string;
  readonly kind?: string;      // petal kind (KINDS)
  readonly petals?: number;
  readonly rot?: number;       // turn of the first petal, radians
  readonly look?: string;      // LOOKS
  readonly width?: number;     // petal half-width as a fraction of R
  readonly lost?: number;      // share of each petal's outline lost (default WASH.lost_edges)
  readonly far_first?: boolean; // paint the upper petals first (a tilted bloom)
}

// A frontal bloom of radius R centred at (cx, cy).
export function bloom(pt: Painter, rng: Rng, cx: number, cy: number, R: number, o: BloomOptions = {}): void {
  const st = o.style === undefined ? undefined : BLOOMS[o.style];
  const base = o.style === undefined ? undefined : STYLES[o.style];
  const pick = (range: readonly [number, number]) => rng.range(range[0], range[1]);
  const n = o.petals ?? (st === undefined ? 5 : rng.int(st.petals[0], st.petals[1]));
  const width = o.width ?? (st === undefined ? 0.34 : pick(st.width));
  const kind = o.kind ?? base?.kind ?? "obovate";
  const lookName = o.look ?? base?.look ?? "vivid";
  const look = LOOKS[lookName];
  const ragged = st?.ragged ?? 0.08;
  const spacing = st?.spacing ?? 0.12;
  const extra: Extra = {};
  if (st !== undefined) {
    extra.eye_fade = st.eye_fade;
    extra.lifts = st.backruns;
    extra.veins = Math.floor(pick(st.veins) + 0.5);
    const rays = Math.floor(pick(st.rays) + 0.5);
    if (rays > 0) extra.rays = { count: rays, reach: st.ray_reach, contrast: st.ray_contrast };
  }
  const a0 = o.rot ?? rng.range(0, 2 * PI);
  // A style with a gap keeps each petal inside its own sector of the eye.
  const sl = st?.gap === undefined ? undefined : slot(n, st.gap, spacing);
  const petals: { r: Rng; a: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng.fork("petal" + fmt(i + 1, 0));
    petals.push({ r, a: a0 + (i * 2 * PI) / n + r.jit(spacing) });
  }
  // A tilted bloom paints its far (upper) petals first, so the near ones
  // overlap them.
  if (o.far_first === true) G.sortBy(petals, (p) => -Math.sin(p.a));
  for (const pe of petals) {
    const r = pe.r;
    const L = R * r.range(1 - ragged * 1.5, 1 + ragged * 0.5);
    const Wd = R * width * r.range(0.92, 1.08);
    const local = petal(r, kind, L, Wd, r.jit(sl === undefined ? 0.10 : 0.04), st?.rim, sl);
    washPetal(pt, r, G.transform(local, cx, cy, pe.a - PI / 2), L, [cx, cy], look, o.lost, extra);
  }
  // Fan blooms keep a small white eye; their rays carry the light out.
  const halo = lookName === "ghost" ? 0.25 : kind === "fan" || kind === "wedge" ? 0.2 : 0.36;
  eye(pt, rng.fork("eye"), cx, cy, R, { halo, stamens: lookName === "ghost" ? 8 : 14 });
}

export interface TiltedOptions {
  readonly kind?: string;
  readonly petals?: number;
  readonly cup?: number;   // depth of the cup
  readonly look?: string;
  readonly width?: number;
  readonly rot?: number;
}

// A bloom seen at an angle. Petals live in a cupped 3D plane tilted by
// `tilt` and turned to face `facing`; they are painted back to front. A
// calyx tube hangs below the cup. Returns the point where a stem attaches.
export function tilted(pt: Painter, rng: Rng, cx: number, cy: number, R: number, facing: number, tilt: number, o: TiltedOptions = {}): Pt {
  const n = o.petals ?? 5;
  const look = LOOKS[o.look ?? "vivid"];
  // The calyx and sepals take the bloom's ink when it is not a blue.
  const calyx = C.recolor(PAL.deep, C.partInk(C.partOf(look.ramp), pt.palette));
  const cup = o.cup ?? 0.6;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const cf = Math.cos(facing - PI / 2), sf = Math.sin(facing - PI / 2);
  const project = (x: number, y: number, z?: number): [Pt, number] => {
    const zz = z ?? (cup * (x * x + y * y)) / R;
    const y2 = y * ct - zz * st, z2 = y * st + zz * ct;
    return [[cx + x * cf - y2 * sf, cy + x * sf + y2 * cf], z2];
  };

  // Calyx: a tapered tube below the cup with small sepals at its mouth.
  const tube: Pt[] = [];
  for (let i = 0; i <= 8; i++) tube.push(project(0, 0, (-R * 0.42 * i) / 8)[0]);
  const stemAt = tube[8];
  const spine = G.splinePoints([tube[8], tube[4], tube[0]], 4);
  pt.fill(G.smooth(G.ribbon(spine, (t) => R * (0.035 + 0.07 * t ** 1.5)), true), calyx, 0.92, { blend: "multiply" });
  const sepals: Leaflet[] = [];
  for (let k = 0; k < 3; k++) {
    const b = rng.range(0, 2 * PI);
    const p0 = project(0, 0, -R * 0.05)[0];
    const p1 = project(R * 0.28 * Math.cos(b), R * 0.28 * Math.sin(b), -R * 0.2)[0];
    sepals.push([p0[0], p0[1], G.angle(p0, p1), G.dist(p0, p1) * 1.1 + R * 0.08]);
  }
  leaflets(pt, rng.fork("sepals"), sepals, calyx, 0.9);
  const a0 = o.rot ?? rng.range(0, 2 * PI);
  const petals: { poly: Pt[]; z: number; L: number; r: Rng }[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng.fork("tp" + fmt(i + 1, 0));
    const a = a0 + (i * 2 * PI) / n + r.jit(0.15);
    const L = R * r.range(0.85, 1.05);
    const Wd = R * (o.width ?? 0.34) * r.range(0.92, 1.08);
    const pts = G.transform(petal(r, o.kind ?? "lance", L, Wd, r.jit(0.15)), 0, 0, a - PI / 2);
    const poly: Pt[] = [];
    let zsum = 0;
    for (const p of pts) {
      const [q, z] = project(p[0], p[1]);
      poly.push(q);
      zsum += z;
    }
    petals.push({ poly, z: zsum / pts.length, L, r });
  }
  G.sortBy(petals, (p) => p.z);
  for (const p of petals) washPetal(pt, p.r, p.poly, p.L, [cx, cy], look);
  const e = project(0, 0)[0];
  eye(pt, rng.fork("eye"), e[0], e[1], R * 0.7, { halo: 0.3, stamens: 9 });
  return stemAt;
}

// A tiny five-petal floret at (x, y) of radius r, turned by `rot`. Tint 1,
// 2 or 3 is deep, blue or sky. Soft florets (baby's breath) are
// translucent, sit in a pale halo that blurs their edge, and keep only a
// faint white eye, so a cloud of them reads as airy rather than as dark
// specks.
export interface Floret {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly rot?: number;
  readonly tint?: 1 | 2 | 3;
  readonly soft?: boolean;
}

// Florets, batched by tint. Florets large enough to read get an ink
// contour, as in an inked-and-washed drawing.
export function florets(pt: Painter, items: readonly Floret[]): void {
  const tints: Cmd[][][] = [[], [], []], soft: Cmd[][][] = [[], [], []];
  const eyes: Cmd[][] = [], specks: Cmd[][] = [], rims: Cmd[][] = [], halos: Cmd[][] = [], softEyes: Cmd[][] = [];
  for (const f of items) {
    const { x, y, r } = f;
    const rot = f.rot ?? 0;
    const isSoft = f.soft === true;
    const bucket = (isSoft ? soft : tints)[(f.tint ?? 2) - 1];
    if (isSoft) halos.push([["o", x, y, 1.05 * r]]);
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * 2 * PI) / 5;
      const p: Cmd[] = [["o", x + 0.55 * r * Math.cos(a), y + 0.55 * r * Math.sin(a), 0.47 * r]];
      bucket.push(p);
      if (r > 1.1 && !isSoft) rims.push(p);
    }
    if (isSoft) {
      if (r > 1.1) softEyes.push([["o", x, y, 0.22 * r]]);
    } else if (r > 0.9) {
      eyes.push([["o", x, y, 0.28 * r]]);
      specks.push([["o", x, y, 0.12 * r]]);
    }
  }
  // The palette's sprays repaint the florets in their ink at the same depths.
  const tint = C.partInk("sprays", pt.palette);
  const cols = [C.recolor(PAL.deep, tint), C.recolor(PAL.blue, tint), C.recolor(PAL.sky, tint)];
  if (halos.length > 0) pt.fillMany(halos, cols[2], 0.14, { blend: "multiply" });
  for (let i = 0; i < 3; i++) {
    if (tints[i].length > 0) pt.fillMany(tints[i], cols[i], 0.88, { blend: "multiply" });
    if (soft[i].length > 0) pt.fillMany(soft[i], cols[i], 0.55, { blend: "multiply" });
  }
  if (softEyes.length > 0) pt.fillMany(softEyes, PAL.white, 0.6);
  if (rims.length > 0) pt.strokeMany(rims, C.mix(C.recolor(PAL.ink, tint), cols[1], 0.5), 0.14, 0.45, { blend: "multiply" });
  if (eyes.length > 0) pt.fillMany(eyes, PAL.white, 0.85);
  if (specks.length > 0) pt.fillMany(specks, PAL.copper, 0.85);
}

// A closed teardrop bud pointing along `ang`.
export function bud(pt: Painter, x: number, y: number, ang: number, len: number, rgb: RGB = PAL.deep): void {
  const half = (t: number) => len * 0.32 * Math.sin(PI * t ** 0.7) ** 0.9;
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) pts.push([-half(i / 16), (len * i) / 16]);
  for (let i = 15; i >= 1; i--) pts.push([half(i / 16), (len * i) / 16]);
  pt.fill(G.smooth(G.transform(pts, x, y, ang - PI / 2), true), rgb, 0.9, { blend: "multiply" });
}

// A bloom of radius R at (cx, cy) seen tilted back by `deg` degrees. The
// bloom is a shallow cup (its rim rises CUP of R toward the viewer at the
// petal tips) turned back about its horizontal axis and seen in
// perspective from VIEW radii away: the far petals stand up behind the eye
// and shrink, the near ones lean forward, grow and foreshorten. Returns the
// projection for Painter.project and the half-height of the projected rim.
const CUP = 0.08, VIEW = 2.8;
export function tilt(cx: number, cy: number, R: number, deg = 0): [Projection, number] {
  const t = (deg * PI) / 180;
  const ct = Math.cos(t), st = Math.sin(t);
  const D = VIEW * R;
  const fn: Projection = (x, y) => {
    const dx = x - cx, dy = y - cy;
    const z = (CUP * Math.min(dx * dx + dy * dy, 1.6 * R * R)) / R;
    const sy = dy * ct + z * st, depth = z * ct - dy * st;
    const s = D / (D - depth);
    return [cx + dx * s, cy + sy * s];
  };
  let rh = 0;
  for (let k = 0; k < 16; k++) rh = Math.max(rh, Math.abs(fn(cx + R * Math.cos((k * PI) / 8), cy + R * Math.sin((k * PI) / 8))[1] - cy));
  return [fn, rh];
}

// Paint the hero bloom at (x, y) of radius R, tilted by HERO.tilt.
export function hero(pt: Painter, rng: Rng, x: number, y: number, R: number): void {
  // At tilt 0 the bloom is painted as is, with no projection at all.
  pt.project(HERO.tilt > 0 ? tilt(x, y, R, HERO.tilt)[0] : undefined);
  bloom(pt, rng, x, y, R, {
    style: HERO.style, look: "hero", petals: HERO.petals, width: HERO.petal_width,
    rot: HERO.rotation >= 0 ? (HERO.rotation * PI) / 180 : undefined, lost: HERO.lost_edges,
    far_first: HERO.tilt > 0,
  });
  pt.project(undefined);
}
