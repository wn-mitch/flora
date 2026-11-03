// Acanthus, the leaf Vitruvius has growing round a basket on a girl's
// grave and Callimachus copying into the Corinthian capital. Here it
// sheathes a rinceau, the running scroll of classical friezes, set under
// a title, and fills a corner round two volutes. Leaves and stems are
// gilt; their veins are tooled in.
//   rinceau          a stem waving out of a calyx each way into a volute,
//                    sheathed in leaves, a tendril off each crest
//   acanthus_corner  two volutes out of the corner along its edges and a
//                    large leaf on the diagonal between them
import { mod } from "#platform";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as Gild from "./orn_gild.ts";
import * as K from "./orn_kit.ts";
import * as Pen from "./orn_pen.ts";
import { register, type Box, type SlotOptions } from "./orn_registry.ts";
import { rosette } from "./orn_roundel.ts";
import type { Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

const PI = Math.PI;

export interface LeafOptions {
  readonly curl?: number;  // the tip turns over by this many turns, signed (0.2)
  readonly lobes?: number; // lobes on each side (4)
  readonly wide?: number;  // half-width as a fraction of the length (0.23)
}

// An acanthus leaf from `base` heading `ang`, `len` long. Its midrib bends
// and its tip turns over by `o.curl` turns; each side has `o.lobes` lobes,
// each a swelling of forward-pointing teeth cut off by a deep notch, the
// two sides out of step. Returns the outline (points, closed), the veins
// (point lists) and the eyes: the small hollows where the notches reach in
// toward the midrib (point lists, closed).
export function leaf(base: Pt, ang: number, len: number, o: LeafOptions = {}): [Pt[], Pt[][], Pt[][]] {
  const curl = o.curl ?? 0.2;
  const rib = G.resample(Pen.path(base, ang, [[len * 0.5, curl * 0.2, "c"], [len * 0.5, curl * 0.8, "in"]])[0], 160);
  const n = o.lobes ?? 4, W = len * (o.wide ?? 0.23);
  const env = (t: number): number => W * Math.sin(PI * (0.06 + 0.94 * t ** 0.8)) ** 0.85 * (1 - 0.3 * t);
  const lobe = (t: number, phase: number): number => {
    const u = mod(t * n + phase, 1);
    const swell = 0.18 + 0.82 * Math.sin(PI * u ** 0.8) ** 0.55;
    const teeth = 0.72 + 0.28 * mod(u * 3, 1) ** 2.2;
    return swell * teeth;
  };
  const m = rib.length;
  const heading = (i: number): number => G.angle(rib[Math.max(0, i - 1)], rib[Math.min(m - 1, i + 1)]);
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1);
    const a = heading(i);
    const stalk = G.smoothstep(0.02, 0.14, t);
    left.push(G.polar(rib[i], a + PI / 2, env(t) * (0.25 + 0.75 * stalk * lobe(t, 0))));
    right.push(G.polar(rib[i], a - PI / 2, env(t) * (0.25 + 0.75 * stalk * lobe(t, 0.5))));
  }
  const out: Pt[] = left.slice();
  for (let i = m - 2; i >= 1; i--) out.push(right[i]);
  // The midrib, a vein out to the head of each lobe and an eye at the foot
  // of each notch.
  const veins: Pt[][] = [rib.slice(0, Math.floor(m * 0.88))];
  const eyes: Pt[][] = [];
  const sides: [number, Pt[]][] = [[0, left], [0.5, right]];
  for (const [side, pts] of sides) {
    for (let k = 0; k < n; k++) {
      const t1 = (k + 0.92 - side) / n;
      if (t1 > 0.12 && t1 < 0.9) {
        const i1 = Math.floor(t1 * (m - 1));
        const i0 = Math.max(0, i1 - Math.floor(m * 0.12));
        veins.push([rib[i0], G.mix(rib[i1], pts[i1], 0.7)]);
      }
      const tn = (k + 1 - side) / n;
      if (tn > 0.15 && tn < 0.85) {
        const j = Math.floor(tn * (m - 1));
        const q = G.mix(rib[j], pts[j], 0.55);
        const r = env(tn) * 0.12;
        eyes.push(K.ellipse(q[0], q[1], r * 1.6, r, heading(j), 12));
      }
    }
  }
  return [out, veins, eyes];
}

// Paint gilt leaves (outlines) with their veins tooled in umber and their
// eyes cut in. `size` scales the tooling.
export function paintLeaves(pt: Painter, leaves: readonly Pt[][], veins: readonly Pt[][], size: number, eyes: readonly Pt[][] = []): void {
  Gild.fill(pt, leaves.map((l) => G.smooth(l, true)), { key: 0.14, shadow: size * 0.01 });
  pt.strokeMany(veins.map((v) => G.smooth(v, false)), Gild.UMBER, G.clamp(size * 0.006, 0.12, 0.3), 0.55);
  if (eyes.length > 0) pt.fillMany(eyes.map((e) => G.smooth(e, true)), Gild.UMBER, 0.6);
}

interface StemSpec {
  readonly pts: Pt[];
  readonly w?: number;
}

// Stems as tapered gilt ribbons, each w wide at its root unless it says.
function stems(pt: Painter, list: readonly StemSpec[], w: number): void {
  const paths: Cmd[][] = list.map((s) => K.taper(s.pts, s.w ?? w, 0.3));
  Gild.fill(pt, paths, { key: 0.12, shadow: w * 0.2 });
}

// Leaves gathered for painting together: outlines, veins and eyes.
interface Bunch {
  readonly leaves: Pt[][];
  readonly veins: Pt[][];
  readonly eyes: Pt[][];
}

function bunch(): Bunch {
  return { leaves: [], veins: [], eyes: [] };
}

function gather(bn: Bunch, l: [Pt[], Pt[][], Pt[][]]): void {
  bn.leaves.push(l[0]);
  for (const x of l[1]) bn.veins.push(x);
  for (const x of l[2]) bn.eyes.push(x);
}

// `bn`'s point lists passed through f, appended to `into`.
function remapInto(into: Bunch, bn: Bunch, f: (this: void, pts: readonly Pt[]) => Pt[]): void {
  for (const l of bn.leaves) into.leaves.push(f(l));
  for (const l of bn.veins) into.veins.push(f(l));
  for (const l of bn.eyes) into.eyes.push(f(l));
}

interface Half {
  readonly stem: Pt[];
  readonly bunch: Bunch;
  readonly tendril: Pt[];
  readonly berries: Pt[];
}

// One half of a rinceau, the right one, in units of about its height,
// written from the calyx outward: a waving stem winding into a large
// volute, leaves sheathing it where it bends, and a tendril off the crest.
function rinceauHalf(rng: Rng): Half {
  const up = rng.chance(0.5) ? 1 : -1;
  const a0 = up * rng.range(0.15, 0.35);
  const swing = rng.range(0.08, 0.14);
  const stem = Pen.path([0.18, -0.12], a0, [
    [rng.range(1.2, 1.5), -up * swing, "bell"],
    [rng.range(1.0, 1.3), up * swing * 0.6, "bell"],
    [rng.range(0.3, 0.45), -up * 0.05, "c"],
    [rng.range(1.5, 1.8), -up * rng.range(1.3, 1.6), "in"],
  ])[0];
  const bn = bunch();
  const add = (at: number, turn: number, len: number, curl: number): void => {
    const [p, a] = G.at(stem, at);
    gather(bn, leaf(p, a + turn, len, { curl, lobes: rng.int(3, 4), wide: rng.range(0.2, 0.25) }));
  };
  // Leaves sheath the stem at its root and as it turns into the volute,
  // each turned away from the stem, the side the stem bends from.
  add(0.02, up * 0.4, rng.range(0.7, 0.85), -up * rng.range(0.2, 0.3));
  add(rng.range(0.58, 0.64), -up * 0.5, rng.range(0.6, 0.75), up * rng.range(0.2, 0.3));
  // A tendril springs from the crest of the wave and curls the other way.
  const [p, a] = G.at(stem, rng.range(0.3, 0.4));
  const tendril = Pen.sprig(p, a + up * 0.9, rng.range(0.45, 0.6), -up, rng.range(0.9, 1.2));
  const tip = tendril[tendril.length - 1];
  const berries: Pt[] = [];
  for (let k = 0; k <= 2; k++) berries.push(G.polar(tip, a + up * (0.6 + k * 0.7), 0.07));
  return { stem, bunch: bn, tendril, berries };
}

function rinceau(this: void, pt: Painter, rng: Rng, b: Box): void {
  const half = rinceauHalf(rng);
  // The calyx: two leaves splayed from the centre and a bud between.
  const calyx = bunch();
  for (const d of [-1, 1]) gather(calyx, leaf([d * 0.04, -0.3], PI / 2 - d * 1.0, 0.6, { curl: -d * 0.25, lobes: 3 }));
  gather(calyx, leaf([0, -0.3], PI / 2, 0.5, { curl: 0, lobes: 3, wide: 0.2 }));
  // Mirror the half into the left, then fit everything to the box.
  const lists: Pt[][] = [half.stem, Pen.mirror(half.stem, 0, -1)];
  for (const l of half.bunch.leaves) {
    lists.push(l);
    lists.push(Pen.mirror(l, 0, -1));
  }
  for (const l of calyx.leaves) lists.push(l);
  const [fit, s] = Pen.fit(Pen.extent(lists), b, Math.min(b[2] - b[0], b[3] - b[1]) * 0.06);
  const left = (l: readonly Pt[]): Pt[] => fit(Pen.mirror(l.slice(), 0, -1));
  stems(pt, [
    { pts: fit(half.stem) }, { pts: left(half.stem) },
    { pts: fit(half.tendril), w: s * 0.03 }, { pts: left(half.tendril), w: s * 0.03 },
  ], s * 0.07);
  const all = bunch();
  remapInto(all, half.bunch, fit);
  remapInto(all, half.bunch, left);
  remapInto(all, calyx, fit);
  paintLeaves(pt, all.leaves, all.veins, s, all.eyes);
  Gild.dots(pt, fit(half.berries).concat(left(half.berries)), s * 0.04);
  // A rosette in the eye of each volute.
  const e = [half.stem[half.stem.length - 1]];
  for (const q of [fit(e)[0], left(e)[0]]) rosette(pt, q[0], q[1], s * 0.13, 8, rng.range(0, PI / 8));
}

function acanthusCorner(this: void, pt: Painter, rng: Rng, b: Box, o: SlotOptions): void {
  K.corner(pt, b, o, (x0, y0, s) => {
    const u = (x: number, y: number): Pt => [x0 + x * s, y0 + y * s];
    // A volute along each edge out of the corner, winding in toward the
    // page; a large leaf on the diagonal between them.
    const list: StemSpec[] = [], bn = bunch();
    const turn = rng.range(1.2, 1.5);
    const edges: [number, number][] = [[0, 1], [PI / 2, -1]];
    for (const [a, d] of edges) {
      const stem = Pen.path(u(0.08, 0.08), a, [[s * 0.4, d * 0.02, "c"], [s * 0.55, d * turn, "in"]])[0];
      list.push({ pts: stem });
      const [p, ta] = G.at(stem, 0.28);
      gather(bn, leaf(p, ta + d * 0.45, s * 0.34, { curl: -d * 0.22, lobes: 3 }));
    }
    const curl = (rng.chance(0.5) ? 1 : -1) * rng.range(0.18, 0.28);
    gather(bn, leaf(u(0.1, 0.1), PI / 4, s * rng.range(0.62, 0.72), { curl, lobes: 4, wide: 0.24 }));
    stems(pt, list, s * 0.05);
    paintLeaves(pt, bn.leaves, bn.veins, s, bn.eyes);
    rosette(pt, x0 + s * 0.08, y0 + s * 0.08, s * 0.09, 8, PI / 8);
  });
}

export function registerAcanthus(): void {
  register({ name: "rinceau", slot: "flourish", label: "Acanthus rinceau", reach: 0.05, draw: rinceau });
  register({ name: "acanthus_corner", slot: "corner", label: "Acanthus corner", reach: 0.04, draw: acanthusCorner });
}
