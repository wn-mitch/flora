// Colour in OKLCH (hue in degrees) and gamma-encoded sRGB [r, g, b] in [0, 1].
import { hypot, mod } from "#platform";

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
