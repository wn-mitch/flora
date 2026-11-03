// Colour in OKLCH (hue in degrees) and gamma-encoded sRGB [r, g, b] in [0, 1].
import { hypot, mod } from "#platform";
import { GROUPS, RAMPS } from "./inks.ts";
import type { Rng } from "./rng.ts";
import { COLOR, PALETTE, type Palette, type Range } from "./tune.ts";

export type RGB = [number, number, number];

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

const cbrt = (x: number) => (x < 0 ? -((-x) ** (1 / 3)) : x ** (1 / 3));

function encode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function decode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// OKLCH to unclipped linear sRGB.
function linear(L: number, Ch: number, h: number): RGB {
  const a = Ch * Math.cos(h * RAD), b = Ch * Math.sin(h * RAD);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(L: number, Ch: number, h: number): boolean {
  const [r, g, b] = linear(L, Ch, h);
  const e = 1e-4;
  return r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && b >= -e && b <= 1 + e;
}

// The largest chroma sRGB can show at lightness L and hue h.
export function maxChroma(L: number, h: number): number {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// OKLCH to sRGB, chroma reduced into gamut.
export function oklch(L: number, Ch: number, h: number): RGB {
  const [r, g, b] = linear(L, Math.min(Ch, maxChroma(L, h)), h);
  const clip = (v: number) => Math.max(0, Math.min(1, encode(Math.max(0, v))));
  return [clip(r), clip(g), clip(b)];
}

function lms(rgb: RGB): [number, number, number] {
  const r = decode(rgb[0]), g = decode(rgb[1]), b = decode(rgb[2]);
  return [
    cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b),
  ];
}

// The OKLab lightness of an sRGB colour.
export function lightness(rgb: RGB): number {
  const [l, m, s] = lms(rgb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

// An sRGB colour as OKLCH: [L, chroma, hue in degrees].
export function lch(rgb: RGB): [number, number, number] {
  const [l, m, s] = lms(rgb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, hypot(A, B), mod(Math.atan2(B, A) * DEG, 360)];
}

// The ground `backdrop: "dark"` paints for: the near-black of a dark web page.
export const DARK_GROUND: RGB = oklch(0.17, 0.012, 230);

function hexDigit(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

// The ground for backdrop setting `v` ("light", "dark" or "#rrggbb"):
// undefined for light (white paper), or an error message for anything
// else and for a colour too light to paint light ink over.
export function backdrop(v: string | undefined): { ground?: RGB; error?: string } {
  if (v === undefined || v === "light") return {};
  if (v === "dark") return { ground: DARK_GROUND };
  const d: number[] = [];
  if (v.length === 7 && v.charCodeAt(0) === 35) for (let i = 1; i < 7; i++) d.push(hexDigit(v, i));
  if (d.length !== 6 || d.some((x) => x < 0)) return { error: "backdrop must be light, dark or a colour as #rrggbb" };
  const rgb: RGB = [(d[0] * 16 + d[1]) / 255, (d[2] * 16 + d[3]) / 255, (d[4] * 16 + d[5]) / 255];
  if (lightness(rgb) > 0.5) return { error: "a backdrop colour must be dark; use light for pale paper" };
  return { ground: rgb };
}

// The lightness the darkest ink reaches on a dark ground.
const GLOW = 0.94;
// Under 1, pale tints are lifted further off the ground than a straight
// turn-over puts them, since the eye tells dark tones apart less well.
const LIFT = 0.7;

// `rgb`, painted for paper `paper`, repainted for dark ground `ground`:
// lightness turned over so the paper's own lightness lands on the ground's
// and the darkest ink on GLOW, with hue and chroma kept, so a dilute wash
// stays near the ground and a pooled one shines most.
export function onGround(rgb: RGB, ground: RGB, paper: RGB): RGB {
  const Lp = lightness(paper), Lg = lightness(ground);
  const [L, Ch, h] = lch(rgb);
  const t = Math.max(0, Math.min(1, (Lp - L) / Lp)) ** LIFT;
  return oklch(Lg + t * (GLOW - Lg), Ch, h);
}

const pick = (rng: Rng, r: Range) => rng.range(r[0], r[1]);

// Index of the most chromatic stop of each ink's ramp, found when first
// asked for. Darker than that stop the colour is held there: the densest
// strokes of some scans turn off-hue (sheen), and dark stems would
// otherwise pick that up.
const richest: Record<string, number> = {};
function richestOf(name: string): number {
  const known = richest[name];
  if (known !== undefined) return known;
  let best = -1, bi = 0;
  RAMPS[name].forEach((s, i) => {
    const c = s[1] * s[1] + s[2] * s[2];
    if (c > best) {
      best = c;
      bi = i;
    }
  });
  richest[name] = bi;
  return bi;
}

// The ink `name`'s colour where its wash has lightness L, as OKLCH chroma
// and hue: its measured ramp interpolated by lightness from its richest
// stop to its palest, held at either end beyond that.
export function inkAt(name: string, L: number): [number, number] {
  const r = RAMPS[name].slice(richestOf(name));
  const lo = r[0], hi = r[r.length - 1];
  let a = hi[1], b = hi[2];
  if (L <= lo[0]) {
    a = lo[1];
    b = lo[2];
  } else if (L < hi[0]) {
    for (let i = 0; i < r.length - 1; i++) {
      const p = r[i], q = r[i + 1];
      if (L >= p[0] && L <= q[0]) {
        const t = (L - p[0]) / Math.max(1e-9, q[0] - p[0]);
        a = p[1] + (q[1] - p[1]) * t;
        b = p[2] + (q[2] - p[2]) * t;
        break;
      }
    }
  }
  return [Math.sqrt(a * a + b * b), mod(Math.atan2(b, a) * DEG, 360)];
}

// The ink a shape is painted with, for palette choice `choice`: undefined
// for "look" (the look's own gradient), a member of an ink group picked
// with `rng` (the group's first without one), or the named ink.
export function inkFor(rng: Rng | undefined, choice: string | undefined): string | undefined {
  if (choice === undefined || choice === "look") return undefined;
  const g = GROUPS[choice];
  if (g !== undefined) return g[rng === undefined ? 0 : rng.int(0, g.length - 1)];
  if (RAMPS[choice] !== undefined) return choice;
  return undefined;
}

// sRGB for ink `name` at lightness L, its chroma scaled by `share`.
export function inkRgb(name: string, L: number, share = 1): RGB {
  const [ch, h] = inkAt(name, L);
  return oklch(L, ch * share, h);
}

// Which palette part a look paints by default.
const PART: Readonly<Record<string, string>> = { leaf: "leaves", hero: "hero", vivid: "blooms", fan: "blooms", soft: "blooms", ghost: "ghost" };

export function partOf(look: string): string | undefined {
  return PART[look];
}

// The one ink that recolours part `part`'s fixed pigments (rim pools,
// florets, the cartouche), without spending randomness: the named ink, or
// the first ink of a group. Undefined for "look" and for the blue group,
// whose inks the fixed blue pigments already match.
export function partInk(part: string | undefined, palette: Palette = PALETTE): string | undefined {
  const choice = part === undefined ? undefined : palette[part];
  if (choice === undefined || choice === "look" || choice === "blue") return undefined;
  if (RAMPS[choice] !== undefined) return choice;
  const g = GROUPS[choice];
  return g === undefined ? undefined : g[0];
}

// `rgb` repainted in ink `ink` at the same lightness, or `rgb` itself when
// there is no ink or the ink is one of the blues.
export function recolor(rgb: RGB, ink: string | undefined): RGB {
  if (ink === undefined || GROUPS.blue.includes(ink)) return rgb;
  return inkRgb(ink, lightness(rgb), 1);
}

export type Stops = [number, RGB][];

// What a ramp's shape was painted with, for matching glazes: its hue, its
// tip lightness, its share of the chroma sRGB allows, and its ink if any.
export interface RampInfo {
  readonly h: number;
  readonly L: number;
  readonly share: number;
  readonly ink?: string;
}

// A base-to-tip ramp for one shape of look `look` ("vivid", "soft", "ghost",
// "leaf", ...). Lightness falls from base to tip along t^curve; chroma is a
// fixed share of what sRGB allows at each step, so pale tones stay blue
// rather than grey; hue drifts from cerulean at the base to the shape's own
// hue at the tip. When `palette` names an ink (or ink group) for `part`
// (default: the look's own part), lightness still follows the look but
// colour comes from the ink's measured ramp at each lightness, so the hue
// and saturation shift as the ink thins, as a real wash does.
export function ramp(rng: Rng, look: string, palette: Palette = PALETTE, part?: string): [Stops, RampInfo] {
  const cfg = COLOR;
  const lk = cfg.looks[look] ?? cfg.looks.vivid;
  const h = cfg.hue + rng.jit(cfg.hue_jitter);
  const baseL = pick(rng, lk.base_l), tipL = pick(rng, lk.tip_l);
  let share = pick(rng, lk.chroma);
  const curve = pick(rng, lk.curve);
  let grey = 1;
  if (look === "leaf" && rng.chance(cfg.grey_chance)) {
    grey = cfg.grey_share;
    share = share * cfg.grey_share;
  }
  const stops: Stops = [];
  const n = 8;
  const key = part ?? PART[look];
  const ink = inkFor(rng, key === undefined ? undefined : palette[key]);
  if (ink !== undefined) {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      stops.push([t, inkRgb(ink, baseL + (tipL - baseL) * t ** curve, grey)]);
    }
    const [ch, ih] = inkAt(ink, tipL);
    return [stops, { h: ih, L: tipL, share: Math.min(1, (ch * grey) / Math.max(1e-6, maxChroma(tipL, ih))), ink }];
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const L = baseL + (tipL - baseL) * t ** curve;
    const hh = h + cfg.hue_drift * (1 - t);
    const s = share * (0.55 + 0.45 * t);
    stops.push([t, oklch(L, s * maxChroma(L, hh), hh)]);
  }
  return [stops, { h, L: tipL, share }];
}

// a mixed toward b by t (0 gives a, 1 gives b).
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
