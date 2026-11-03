// Broken, directional brushwork: pigment bands and pale striations that
// follow a shape's growth direction. Each mark swells and pinches, breaks
// into pieces with gaps between them, and sometimes splits into thin
// parallel threads, as a dry brush skips over the paper's grain. Marks are
// drawn inside a shape's clip and under its glazes, so they read as part of
// the wash rather than as lines drawn over it.
import * as C from "./color.ts";
import type { RampInfo, RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";
import { COLOR, type PLANT, type WASH } from "./tune.ts";

// Path commands for an outline as a plain polygon. Brush marks are a few
// points wide with ten points a side, so straight segments read as smooth
// and cost a third of the bytes of a spline.
export function polygon(poly: readonly Pt[]): Cmd[] {
  const cmds: Cmd[] = [["m", poly[0][0], poly[0][1]]];
  for (let i = 1; i < poly.length; i++) cmds.push(["l", poly[i][0], poly[i][1]]);
  cmds.push(["z"]);
  return cmds;
}

// The part of `pts` (uniformly resampled) between fractions t0 and t1.
function slice(pts: readonly Pt[], t0: number, t1: number): Pt[] {
  const n = pts.length;
  const i0 = Math.max(0, Math.floor(t0 * (n - 1)));
  const i1 = Math.min(n - 1, Math.ceil(t1 * (n - 1)));
  return pts.slice(i0, i1 + 1);
}

// `pts` shifted sideways by d (positive: to the left of travel).
function offset(pts: readonly Pt[], d: number): Pt[] {
  const n = pts.length;
  return pts.map((p, i) => G.polar(p, G.angle(pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]) + Math.PI / 2, d));
}

// `pts` shifted sideways by f * w(t) at each point (t its fraction of the
// length), for lines that keep a place across a tapering stem.
function offsetBy(pts: readonly Pt[], wfn: (t: number) => number, f: number): Pt[] {
  const n = pts.length;
  return pts.map((p, i) => G.polar(p, G.angle(pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]) + Math.PI / 2, f * wfn(i / Math.max(1, n - 1))));
}

// Outlines of one broken stroke along polyline `line`, at most `wmax` pt
// wide. `gap` (0-1) sets how much of the length is left unpainted; `dry`
// (0-1) is the chance a piece splits into threads.
export function broken(rng: Rng, line: readonly Pt[], wmax: number, gap: number, dry: number): Pt[][] {
  const pts = G.resample(line, 32);
  const nz = G.noise(rng, 16);
  const phase = rng.range(0, 16);
  const out: Pt[][] = [];
  let t = rng.range(0, 0.12);
  while (t < 0.95) {
    const t1 = Math.min(1, t + rng.range(0.14, 0.5) * (1 - 0.6 * gap));
    let seg = slice(pts, t, t1);
    if (seg.length >= 2) {
      seg = G.resample(seg, 10);
      const a = t, b = t1;
      const w = (u: number) => {
        const tt = a + (b - a) * u;
        const taper = G.smoothstep(0, 0.12, tt) * (1 - tt) ** 0.7;
        const ends = Math.sin(Math.PI * G.clamp(u, 0, 1)) ** 0.6;
        const swell = 0.5 + 0.5 * nz(phase + tt * 9);
        return wmax * taper * ends * (0.2 + swell);
      };
      if (rng.chance(dry)) {
        const k = rng.int(2, 3);
        for (let j = 1; j <= k; j++) {
          const d = (j - (k + 1) / 2) * wmax * 0.9;
          out.push(G.ribbon(offset(seg, d), (u) => w(u) * rng.range(0.25, 0.45)));
        }
      } else {
        out.push(G.ribbon(seg, w));
      }
    }
    t = t1 + rng.range(0.02, 0.12) * gap * 2.5;
  }
  return out;
}

// Paint brushwork inside a clipped shape of characteristic length `size`.
// `dark` and `pale` are centrelines running in the shape's growth
// direction; `info` describes the shape's ramp (color.ts ramp).
export function paint(pt: Painter, rng: Rng, dark: readonly Pt[][], pale: readonly Pt[][], size: number, info: RampInfo, cfg: typeof WASH): void {
  for (const line of dark) {
    const pieces = broken(rng, line, size * rng.range(0.025, 0.06) * cfg.brush_width, cfg.brush_gap, cfg.brush_dry);
    if (pieces.length > 0) {
      const L = G.clamp(info.L + rng.range(0, 0.25), 0.25, 0.9);
      const h = info.h + rng.jit(6);
      const col = C.oklch(L, info.share * C.maxChroma(L, h), h);
      pt.fillMany(pieces.map((p) => polygon(p)), col, rng.range(cfg.band_opacity[0], cfg.band_opacity[1]), { blend: "multiply" });
    }
  }
  for (const line of pale) {
    const pieces = broken(rng, line, size * rng.range(0.012, 0.036) * cfg.brush_width, cfg.brush_gap, cfg.brush_dry);
    // Contrast varies per streak: some are barely lighter than the wash.
    if (pieces.length > 0) pt.fillMany(pieces.map((p) => polygon(p)), PAL.white, rng.range(cfg.pale_contrast[0], cfg.pale_contrast[1]));
  }
}

// The stem body's colour, as stem lays it, for shapes that blend into a
// stem. Where the palette's stems name an ink group, its first ink.
export function stemTone(pt: Painter, cfg: typeof PLANT): RGB {
  const ink = C.inkFor(undefined, pt.palette.stems);
  if (ink !== undefined) return C.inkRgb(ink, cfg.stem_l);
  const h = COLOR.hue;
  return C.oklch(cfg.stem_l, 0.85 * C.maxChroma(cfg.stem_l, h), h);
}

// Paint a stem of full width wfn(t) along `pts` as a brushed wash rather
// than an inked ribbon: a body glaze, a broken darker band down its shadow
// side, a broken pale streak down its lit side, and an ink line along the
// shadow edge that breaks off in places, where the stem melts into the
// paper.
export function stem(pt: Painter, rng: Rng, pts: readonly Pt[], wfn: (t: number) => number, cfg: typeof PLANT): void {
  const h = COLOR.hue;
  const L = cfg.stem_l;
  // The palette's stems may name an ink (or group) for the stems.
  const ink = C.inkFor(rng, pt.palette.stems);
  const tone = (l: number, k: number) => (ink !== undefined ? C.inkRgb(ink, l) : C.oklch(l, k * C.maxChroma(l, h), h));
  const outline = G.smooth(G.ribbon(pts, (t) => wfn(t) / 2), true);
  pt.fill(outline, tone(L, 0.85), 0.55 + 0.35 * (1 - cfg.stem_brush), { blend: "multiply" });
  if (cfg.stem_brush <= 0) return;
  const line = G.resample(pts, Math.max(8, Math.floor(G.length(pts) / 3)));
  let wmax = 0;
  for (let i = 0; i <= 10; i++) wmax = Math.max(wmax, wfn(i / 10));
  pt.clipBegin(outline);
  let pieces = broken(rng, offsetBy(line, wfn, -0.22), wmax * 0.32, 0.3, 0.2);
  if (pieces.length > 0) pt.fillMany(pieces.map((p) => polygon(p)), tone(L * 0.7, 0.9), 0.65 * cfg.stem_brush, { blend: "multiply" });
  pieces = broken(rng, offsetBy(line, wfn, 0.24), wmax * 0.16, 0.45, 0.3);
  if (pieces.length > 0) pt.fillMany(pieces.map((p) => polygon(p)), PAL.white, 0.55 * cfg.stem_brush);
  // Lost stretches: the lit edge dissolves into the paper.
  pieces = broken(rng, offsetBy(line, wfn, 0.5), wmax * 0.3, 0.75, 0);
  if (pieces.length > 0) pt.fillMany(pieces.map((p) => polygon(p)), PAL.white, 0.6 * cfg.stem_brush);
  pt.clipEnd();
  pieces = broken(rng, offsetBy(line, wfn, -0.5), Math.max(0.25, wmax * 0.09), 0.2, 0);
  if (pieces.length > 0) pt.fillMany(pieces.map((p) => polygon(p)), PAL.ink, 0.7 * cfg.stem_brush, { blend: "multiply" });
}
