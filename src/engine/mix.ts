// The page's mix: how much of each kind of growth a page gets, as weights
// (1 = the usual amount, 0 = none, 2 = about twice as much), set from
// \florasetup{mix={lily=2, umbel=0}, density=0.8}; defaults in tune.ts MIX.
// With every weight at 1 a page is exactly the unmixed page.
//
//   bloom, soft, lily, ghost, umbel, cyme, gyps   motifs in the holes
//                                                 (grow.ts): weight and cap
//   leaves, leaflets                              spacing along the stems
//   feather, acanthus, lance                      how often a large leaf
//                                                 takes each shape (leaf.ts)
//   fan, round                                    how often a small bloom
//                                                 takes each style (flower.ts)
//   sprays, curls                                 the spray cap, curl chance
//   density                                       the gesture's density field,
//                                                 spacing and smallest hole
//   bee, butterfly, bird, snail                   visitors
import { sortedKeys } from "#platform";
import { ORDER } from "./inks.ts";
import { Rng } from "./rng.ts";
import { COMPOSE, MIX, type Palette, type Range } from "./tune.ts";

export type Mix = Readonly<Record<string, number>>;

export const MOTIFS = ["bloom", "soft", "lily", "ghost", "umbel", "cyme", "gyps"];
export const VISITORS = ["bee", "butterfly", "bird", "snail"];

// The weight of `kind` in `mix` (overrides; undefined for the defaults).
export function weight(mix: Mix | undefined, kind: string): number {
  return mix?.[kind] ?? MIX[kind] ?? 1;
}

// Is every growth weight at its neutral 1?
function neutral(mix: Mix | undefined): boolean {
  for (const k of ["leaves", "leaflets", "sprays", "curls", "density"]) if (weight(mix, k) !== 1) return false;
  return true;
}

const scaled = (range: Range, k: number): Range => [range[0] * k, range[1] * k];

// The composition settings a page grows with (tune.ts COMPOSE adjusted by
// its mix), with `no_leaflets` set when the mix has none.
export interface ComposeCfg {
  readonly hero: number;
  readonly features: Range;
  readonly leaves: number;
  readonly leaf_size: number;
  readonly leaf_width: Range;
  readonly leaf_overlap: number;
  readonly leaf_spacing: Range;
  readonly hole_min: number;
  readonly sprays: number;
  readonly small_blooms: number;
  readonly curls: number;
  readonly leaflet_spacing: Range;
  readonly leaflet_size: number;
  readonly no_leaflets?: boolean;
  readonly budget?: number;
}

// COMPOSE adjusted by the mix's leaves, leaflets, sprays, curls and
// density weights; COMPOSE itself when they are all 1.
export function cfg(base: ComposeCfg = COMPOSE, mix?: Mix): ComposeCfg {
  if (neutral(mix)) return base;
  // Density also widens the spacing of everything and the smallest hole
  // worth filling, so a low density reads as airier, not just paler.
  const k = Math.max(weight(mix, "density"), 0.05);
  const wl = weight(mix, "leaves"), wf = weight(mix, "leaflets");
  return {
    ...base,
    hole_min: base.hole_min / k,
    leaves: wl <= 0 ? 0 : Math.floor(base.leaves * Math.max(1, wl) + 0.5),
    leaf_spacing: wl <= 0 ? base.leaf_spacing : scaled(base.leaf_spacing, 1 / (wl * k)),
    no_leaflets: wf <= 0,
    leaflet_spacing: wf > 0 ? scaled(base.leaflet_spacing, 1 / (wf * k)) : base.leaflet_spacing,
    sprays: Math.floor(base.sprays * weight(mix, "sprays") * Math.min(1, k) + 0.5),
    curls: base.curls * weight(mix, "curls"),
  };
}

// `c` with its caps on how much grows (large leaves, fine sprays, small
// blooms, and the soft blooms, lilies and umbels, motifCap) scaled by
// `b`, for a plant longer than a page, which would otherwise run out of
// growth part way along; `c` itself when b is undefined or 1. Spacing is
// unchanged, so a longer plant is as full as a page's, not fuller.
export function budget(c: ComposeCfg, b: number | undefined): ComposeCfg {
  if (b === undefined || b === 1) return c;
  const r = (n: number) => Math.max(0, Math.floor(n * b + 0.5));
  return { ...c, leaves: r(c.leaves), sprays: r(c.sprays), small_blooms: r(c.small_blooms), budget: b };
}

// A hole motif's cap `n` under cfg's budget (budget above).
export function motifCap(n: number, c: ComposeCfg): number {
  return c.budget === undefined ? n : Math.max(1, Math.floor(n * c.budget + 0.5));
}

// The density field `dens` scaled by the mix's density weight, or `dens`
// itself at weight 1.
export function density(dens: (x: number, y: number) => number, mix?: Mix): (x: number, y: number) => number {
  const k = weight(mix, "density");
  if (k === 1) return dens;
  return (x, y) => Math.min(1, dens(x, y) * k);
}

// A hole motif (grow.ts): its weight, cap, the radius range it comes in,
// and whether it is a spray or kept to the lower part of the margin.
export interface Motif {
  readonly kind: string;
  readonly w: number;
  readonly cap?: number;
  readonly rmin: number;
  readonly rmax: number;
  readonly below?: number;
  readonly spray?: boolean;
}

// Motif `m` with its weight and cap scaled by the mix, or undefined when
// its weight is 0. At weight 1 the motif is returned unchanged.
export function motif(m: Motif, mix?: Mix): Motif | undefined {
  const w = weight(mix, m.kind);
  if (w === 1) return m;
  if (w <= 0) return undefined;
  if (m.cap === undefined) return { ...m, w: m.w * w };
  return { ...m, w: m.w * w, cap: Math.max(1, Math.floor(m.cap * w + 0.5)) };
}

// A seed as a number, as Lua's tonumber reads it; undefined when it is not
// one.
export function toNumber(v: string | number | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (v === undefined) return undefined;
  const n = Number(v);
  return typeof n === "number" && n === n ? n : undefined;
}

// `palette` with each "random" part replaced by one ink, drawn from its own
// stream for page seed `seed` and colour spin `spin`. Shapes never draw
// from that stream, and a single ink spends no shape randomness, so
// spinning changes the colours and nothing else.
export function resolve(palette: Palette | undefined, seed?: string | number, spin?: string | number): Palette | undefined {
  if (palette === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const part of sortedKeys(palette)) {
    let v = palette[part];
    if (v === "random") {
      const r = new Rng((toNumber(seed) ?? 1) + (toNumber(spin) ?? 0) * 104723).fork("ink " + part);
      v = ORDER[r.int(1, ORDER.length) - 1];
    }
    out[part] = v;
  }
  return out;
}
