// Watercolour rendering of a closed shape. A shape is painted as glazes
// rather than a flat fill:
//   1. two jittered underwash layers that bleed slightly past the contour;
//   2. the pigment body, multiplied onto the paper;
//   3. a base-to-tip gradient generated per shape (color.ts ramp) with
//      brushwork, variegated glazes, back-runs and a tideline on top; or,
//      without a ramp, nested lightening layers that shrink toward a light
//      point;
//   4. a wide inner band along the clipped contour (the wet edge);
//   5. streaks: tapered white and dark hairlines fanning from the light point;
//   6. granulation: speckle of dark and pale dots;
//   7. an optional ink contour;
// with lost and found edges: along part of the contour the rim, the ink and
// the wash itself give way to the paper, and the eye completes the form.
import { mod, sortNumbers } from "#platform";
import * as Brush from "./brush.ts";
import * as C from "./color.ts";
import type { RampInfo, RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import { PAL, type Painter } from "./paint.ts";
import { Rng } from "./rng.ts";
import { WASH } from "./tune.ts";

// Shade the clipped shape along base -> tip with a ramp generated for look
// `look`. The ramp is stretched by a random factor, so how far the deep tone
// reaches and how large the pale base is differ from shape to shape.
// Returns the ramp's description for matching glazes.
function rampFill(pt: Painter, rng: Rng, look: string, base: Pt, tip: Pt, half: number, part: string | undefined): RampInfo {
  const [stops, info] = C.ramp(rng, look, pt.palette, part);
  // A shading stops at its ends; a hooked tip that curls past the end
  // would show bare paper, so lay the tip colour underneath first.
  pt.fill([["o", (base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, half]], stops[stops.length - 1][1], 1);
  const reach = rng.range(0.82, 1.12);
  const start = G.mix(base, tip, -rng.range(0.0, 0.18));
  pt.shade(stops, start, G.mix(base, tip, reach), half);
  return info;
}

// A random point inside `poly`, or its centroid if sampling misses.
function insidePoint(rng: Rng, poly: readonly Pt[]): Pt {
  const [x0, y0, x1, y1] = G.bbox(poly);
  for (let i = 0; i < 30; i++) {
    const x = rng.range(x0, x1), y = rng.range(y0, y1);
    if (G.inside(poly, x, y)) return [x, y];
  }
  return G.centroid(poly);
}

// An irregular blot of radius r around c.
function blot(rng: Rng, c: Pt, r: number): Cmd[] {
  const pts: Pt[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k * Math.PI) / 12;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return G.smooth(G.deform(pts, rng, r * 0.28), true);
}

// Variegation inside a clipped shape, after its ramp: glazes of a
// neighbouring hue that pool unevenly (wet-on-wet), pale back-runs whose
// edges darken where the lifted pigment dried, and a tideline of pooled
// pigment along part of the contour.
function variegate(pt: Painter, rng: Rng, poly: readonly Pt[], size: number, info: RampInfo, lifts: number): void {
  const cfg = WASH;
  const blotches = rng.int(cfg.blotches[0], cfg.blotches[1]);
  for (let i = 0; i < blotches; i++) {
    const c = insidePoint(rng, poly);
    const h = info.h + rng.jit(cfg.blotch_hue);
    const L = rng.range(Math.max(0.35, info.L - 0.05), 0.82);
    const col = C.oklch(L, info.share * rng.range(0.6, 1.0) * C.maxChroma(L, h), h);
    pt.fill(blot(rng, c, size * rng.range(0.16, 0.40)), col, rng.range(cfg.blotch_opacity[0], cfg.blotch_opacity[1]), { blend: "multiply" });
  }
  const backruns = Math.floor(rng.int(cfg.lifts[0], cfg.lifts[1]) * lifts);
  for (let i = 0; i < backruns; i++) {
    const c = insidePoint(rng, poly);
    const b = blot(rng, c, size * rng.range(0.10, 0.22));
    pt.fill(b, PAL.white, rng.range(cfg.lift_opacity[0], cfg.lift_opacity[1]));
    const edge = C.oklch(info.L + 0.15, 0.6 * C.maxChroma(info.L + 0.15, info.h), info.h);
    pt.stroke(b, edge, size * 0.012, 0.22, { blend: "multiply" });
  }
  if (rng.chance(cfg.tideline_chance)) {
    const n = poly.length;
    const i0 = rng.int(0, n - 1);
    const run: Pt[] = [];
    const k1 = Math.floor(n * rng.range(0.25, 0.5));
    for (let k = 0; k <= k1; k++) run.push(poly[mod(i0 + k, n)]);
    if (run.length >= 3) {
      const col = C.oklch(info.L * 0.85, C.maxChroma(info.L * 0.85, info.h) * 0.8, info.h);
      pt.stroke(G.smooth(run, false), col, size * 0.03, 0.35, { blend: "multiply" });
    }
  }
}

// Tapered stroke outline along `line`, widest near the start.
export function taper(line: readonly Pt[], wmax: number, head = 0.12): Pt[] {
  return G.ribbon(line, (t) => wmax * G.smoothstep(0, head, t) * (1 - t) ** 1.1 + 0.02);
}

// Fill a batch of tapered hairlines as one shape.
export function hairlines(pt: Painter, lines: readonly (readonly Pt[])[], rgb: RGB, wmax: number, opacity: number, o: { head?: number; blend?: "multiply" } = {}): void {
  if (lines.length === 0) return;
  pt.fillMany(lines.map((line) => G.smooth(taper(line, wmax, o.head), true)), rgb, opacity, { blend: o.blend });
}

export interface GrainOptions {
  readonly cap?: number;
  readonly scale?: number;
  readonly clump?: number;
  readonly mottle?: number;
  readonly rim?: number;
  readonly dark?: number;
  readonly dark_rgb?: RGB;
  readonly dark_op?: number;
  readonly pale_op?: number;
}

// Speckle inside `poly`, `density` dots per square pt. Dots crowd toward the
// rim when `rim` > 0. A share `clump` of them settle in small clumps around
// a seed dot, and `mottle` lays faint dark and pale patches a few points
// across beneath them, so the pigment reads as granulated rather than
// sprinkled.
export function grain(pt: Painter, rng: Rng, poly: readonly Pt[], density: number, o: GrainOptions = {}): void {
  const [x0, y0, x1, y1] = G.bbox(poly);
  const area = Math.abs(G.area(poly));
  const n = Math.min(Math.floor(area * density), o.cap ?? 1600);
  const c = G.centroid(poly);
  const reach = Math.max(x1 - x0, y1 - y0) / 2;
  const scale = o.scale ?? 1;
  const clump = o.clump ?? 0;
  const dark: Cmd[][] = [], pale: Cmd[][] = [];
  // Dots are drawn inside the clip, so they are sampled from the shape's
  // row spans rather than tested point by point. The attempt budget is the
  // number of in-shape points that bounding-box sampling would have found.
  const sample = G.spanSampler(poly, Math.max(0.3, (y1 - y0) / 150));
  if (sample === undefined) return;
  const budget = (n * 4 * area) / Math.max(1e-9, (x1 - x0) * (y1 - y0));
  const mottle = o.mottle ?? 0;
  if (mottle > 0) {
    const blotsDark: Cmd[][] = [], blotsPale: Cmd[][] = [];
    const count = Math.min(60, Math.floor((area / 30) * mottle + 0.5));
    for (let i = 0; i < count; i++) {
      const p = sample(rng);
      if (p === undefined) continue;
      const b = blot(rng, p, rng.range(0.8, 2.6) * scale);
      if (rng.chance(0.6)) blotsDark.push(b);
      else blotsPale.push(b);
    }
    if (blotsDark.length > 0) pt.fillMany(blotsDark, o.dark_rgb ?? PAL.deep, 0.10 * Math.min(1.5, mottle), { blend: "multiply" });
    if (blotsPale.length > 0) pt.fillMany(blotsPale, PAL.white, 0.10 * Math.min(1.5, mottle));
  }
  const dot = (x: number, y: number, isDark: boolean) => {
    const r = rng.range(0.10, 0.32) * scale;
    if (isDark) dark.push([["o", x, y, r]]);
    else pale.push([["o", x, y, r * 0.9]]);
  };
  let tries = 0;
  while (dark.length + pale.length < n && tries < budget) {
    tries++;
    const p = sample(rng);
    if (p === undefined) continue;
    const edge = G.dist(c, p) / reach;
    if (rng.next() < 0.35 + (o.rim ?? 0.6) * edge) {
      const isDark = rng.next() < (o.dark ?? 0.6);
      // A clump of k dots (5 on average) is seeded with probability p, so
      // p 5 / (p 5 + 1 - p) = clump of the dots are clumped; clumps count
      // against the total, so the density stays as asked.
      if (clump > 0 && rng.next() < clump / (5 - 4 * Math.min(1, clump))) {
        const k = rng.int(3, 7), cr = rng.range(0.5, 1.4) * scale;
        const m = Math.min(k, n - dark.length - pale.length);
        for (let j = 0; j < m; j++) dot(p[0] + rng.jit(1) * cr, p[1] + rng.jit(1) * cr, isDark);
      } else {
        dot(p[0], p[1], isDark);
      }
    }
  }
  if (dark.length > 0) pt.fillMany(dark, o.dark_rgb ?? PAL.deep, o.dark_op ?? 0.38, { blend: "multiply" });
  if (pale.length > 0) pt.fillMany(pale, PAL.white, o.pale_op ?? 0.45);
}

// Streak centrelines fanning from `from` toward the contour's vertices.
export function fan(rng: Rng, poly: readonly Pt[], from: Pt, count: number, reach0 = 0.55, reach1 = 0.95): Pt[][] {
  const lines: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const v = poly[rng.int(0, poly.length - 1)];
    const t0 = rng.range(0.02, 0.18);
    const t1 = rng.range(reach0, reach1);
    const a = G.mix(from, v, t0);
    const b = G.mix(from, v, t1);
    const bow = rng.jit(0.06) * G.dist(a, b);
    const m = G.polar(G.mix(a, b, 0.5), G.angle(a, b) + Math.PI / 2, bow);
    lines.push(G.splinePoints([a, m, b], 6));
  }
  return lines;
}

// Lost and found edges. The contour is split into runs where the edge is
// found (rim and ink drawn) and runs where it is lost (the wash fades into
// the paper). Edges are lost mostly where `paleAt` (0-1 at a point) says the
// shape is palest, so light washes meet the page without a boundary while
// the deep end keeps a crisp edge. `share` is the fraction of the contour
// lost. Returns the found and lost runs as open polylines that share their
// end points, or undefined when nothing is lost.
export function edgeRuns(rng: Rng, poly: readonly Pt[], paleAt: (p: Pt) => number, share: number): [Pt[][], Pt[][]] | undefined {
  if (share <= 0) return undefined;
  const N = 96;
  const ring = poly.slice();
  ring.push(poly[0]);
  const pts = G.resample(ring, N + 1);
  pts.pop();
  // Noise with a period of the whole contour, so the ends agree.
  const nz = G.noise(rng, 6), ph = rng.int(0, 5);
  const score = pts.map((p, i) => 0.3 * paleAt(p) + 0.7 * (0.5 + 0.5 * nz(ph + (i / N) * 6)));
  const sorted = score.slice();
  sortNumbers(sorted);
  const k = Math.floor(N * (1 - share) + 0.5);
  if (k >= N) return undefined;
  const cut = k >= 1 ? sorted[k - 1] : -Infinity;
  const lost = score.map((s) => s > cut);
  // Start the walk at a change from found to lost.
  let start = -1;
  for (let i = 0; i < N; i++) {
    if (lost[i] && !lost[mod(i - 1, N)]) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const found: Pt[][] = [], lostRuns: Pt[][] = [];
  let run: Pt[] = [pts[mod(start - 1, N)]];
  let state = true;
  for (let j = 0; j < N; j++) {
    const i = mod(start + j, N);
    if (lost[i] !== state) {
      (state ? lostRuns : found).push(run);
      run = [run[run.length - 1]];
      state = lost[i];
    }
    run.push(pts[i]);
  }
  run.push(pts[mod(start - 1, N)]);
  (state ? lostRuns : found).push(run);
  return [found, lostRuns];
}

// A filled band of half-width `w` along open polyline `run`, tapering to
// nothing over the first and last `taper` of its length. With `rng` the
// band's edges are displaced by up to `wobble` pt.
function band(run: readonly Pt[], w: number, tp: number, rng?: Rng, wobble = 0, scaleAt?: (p: Pt) => number): Cmd[] {
  const line = G.resample(run, Math.max(4, run.length));
  let poly = G.ribbon(line, (t) => {
    const s = scaleAt === undefined ? 1 : scaleAt(line[Math.floor(t * (line.length - 1) + 0.5)]);
    return w * s * G.smoothstep(0, tp, t) * G.smoothstep(0, tp, 1 - t);
  });
  if (rng !== undefined) poly = G.deform(poly, rng, wobble);
  return G.smooth(poly, true);
}

function bands(runs: readonly Pt[][], w: number, tp: number, rng?: Rng, wobble = 0, scaleAt?: (p: Pt) => number): Cmd[][] {
  const out: Cmd[][] = [];
  for (const r of runs) if (r.length >= 2) out.push(band(r, w, tp, rng, wobble, scaleAt));
  return out;
}

export interface WashOptions {
  readonly rng: Rng;               // random stream
  readonly size: number;           // characteristic length of the shape, pt
  readonly pigment?: RGB;          // body colour
  readonly pool?: RGB;             // the darker rim colour
  readonly light?: Pt;             // point the wash lightens toward (default: centroid)
  readonly strength?: number;      // overall pigment load, 0-1
  readonly knockout?: number;      // opacity of the paper laid under the shape (0 to glaze through)
  readonly bleed?: number;         // how far the underwash strays past the contour, pt
  readonly rings?: number;         // lightening layers, without a ramp
  readonly lift?: number;          // their white opacity
  readonly streaks?: number;       // white streaks
  readonly dark_streaks?: number;  // dark streaks
  // White rays from `light`: how many, how far (share of the way to the
  // rim) and their opacity.
  readonly rays?: { readonly count: number; readonly reach: readonly [number, number]; readonly contrast: readonly [number, number] };
  readonly grain?: number;         // dots per square pt
  readonly grain_scale?: number;
  readonly outline?: number;       // contour opacity, 0 for none
  readonly outline_w?: number;
  readonly lost?: number;          // share of the contour whose edge is lost (default WASH.lost_edges)
  readonly eye_fade?: number;      // 0-1: how far a lost edge's fade is kept to the pale end
  readonly lifts?: number;         // multiplier on the number of back-runs
  readonly pale_scale?: number;    // multiplier on the number of pale brush strokes
  readonly fade_scale?: number;    // multiplier on how far a lost edge fades in
  readonly part?: string;          // palette part whose ink paints the ramp (default: the look's)
  readonly ink?: string;           // ink recolouring the fixed blue pigment, pool, grain and contour
  readonly simple?: boolean;       // small shapes: no brushwork, glazes or back-runs; 3 fade layers
  readonly inner?: (pt: Painter) => void;  // called while clipped, for veins and the like
  // `n` centrelines for brushwork (default: a fan from `light` toward the
  // contour).
  readonly brush_lines?: (rng: Rng, n: number) => Pt[][];
  // Look for color.ts ramp; with `axis` [base, tip] the body is a
  // continuous gradient instead of lightening layers.
  readonly ramp?: string;
  readonly axis?: readonly [Pt, Pt];
  // How the wash is laid down (Painter.lay): the body flooded along a line
  // and, after it, the outline traced round the contour.
  readonly sweep?: WashSweep;
}

// A wash's lays: the body swept along `along` by a band `half` either side
// over `body` pt of growth, with a wet front `wet` wide; the outline traced
// from `line[0]` after the wash starts, over `line[1]`.
export interface WashSweep {
  readonly along: readonly Pt[];
  readonly half: number;
  readonly body: number;
  readonly wet: number;
  readonly line: readonly [number, number];
}

// Paint `poly` as a watercolour glaze; see the module comment for the layers.
export function wash(pt: Painter, poly: readonly Pt[], o: WashOptions): void {
  const rng = o.rng, size = o.size, s = o.strength ?? 1;
  const cfg = WASH;
  // A part painted in a non-blue ink takes that ink for its fixed blue
  // pigments too, so its bleed and pooled rim are not ultramarine.
  const part = o.part ?? (o.ramp === undefined ? undefined : C.partOf(o.ramp));
  const tint = o.ink ?? C.partInk(part, pt.palette);
  const pig = C.recolor(o.pigment ?? PAL.blue, tint);
  let pool = C.recolor(o.pool ?? PAL.deep, tint);
  let line = C.recolor(PAL.ink, tint);
  let grainRgb = C.recolor(PAL.deep, tint);
  const light = o.light ?? G.centroid(poly);
  const body = G.smooth(poly, true);
  const axis = o.axis;
  let paleAt: (p: Pt) => number;
  if (o.ramp !== undefined && axis !== undefined) {
    const dx = axis[1][0] - axis[0][0], dy = axis[1][1] - axis[0][1];
    const dd = Math.max(1e-9, dx * dx + dy * dy);
    paleAt = (p) => 1 - G.clamp(((p[0] - axis[0][0]) * dx + (p[1] - axis[0][1]) * dy) / dd, 0, 1);
  } else {
    let far = 1e-9;
    for (const p of poly) far = Math.max(far, G.dist(p, light));
    paleAt = (p) => 1 - G.dist(p, light) / far;
  }
  const erng = new Rng(rng.int(1, 2 ** 30));
  const runs = edgeRuns(erng, poly, paleAt, o.lost ?? cfg.lost_edges);

  const sw = o.sweep;
  const bodyLays = sw === undefined ? [] : [{ along: sw.along, half: sw.half, dur: sw.body, wet: sw.wet }];
  const lineLays = sw === undefined ? [] : [{ start: sw.line[0], dur: sw.line[1], along: ringFrom(poly, sw.along[0]), half: (o.outline_w ?? 0.28) + 1 }];
  const layBody = (fn: () => void) => (sw === undefined ? fn() : pt.lay(bodyLays, fn));
  const layLine = (fn: () => void) => (sw === undefined ? fn() : pt.lay(lineLays, fn));
  layBody(() => {
    // Knock out what lies beneath so a front petal covers the one behind it
    // instead of glazing over it.
    const knockout = o.knockout ?? 0.9;
    if (knockout > 0) pt.fill(body, PAL.paper, knockout);
    const bleed = o.bleed ?? size * 0.022;
    for (let i = 0; i < 2; i++) pt.fill(G.smooth(G.deform(poly, rng, bleed), true), pig, 0.10 * s, { blend: "multiply" });
    if (o.ramp !== undefined) {
      if (axis === undefined) throw new Error("wash: a ramp needs an axis");
      // A continuous base-to-tip gradient: the full range from paper white to
      // deep ultramarine within one shape.
      pt.clipBegin(body);
      const info = rampFill(pt, rng, o.ramp, axis[0], axis[1], size * 1.5, o.part);
      // An ink group picks one ink per shape; the rim pools in that ink.
      if (info.ink !== undefined) {
        pool = C.recolor(o.pool ?? PAL.deep, info.ink);
        line = C.recolor(PAL.ink, info.ink);
        grainRgb = C.recolor(PAL.deep, info.ink);
      }
      // Broken brushwork along the growth direction, then the glazes over it.
      const k = G.clamp(size / 30, 0.3, 1.3);
      const nd = Math.floor(rng.range(cfg.brush_bands[0], cfg.brush_bands[1]) * k + 0.5);
      const np = Math.floor(rng.range(cfg.brush_pale[0], cfg.brush_pale[1]) * k * (o.pale_scale ?? 1) + 0.5);
      const lines = o.brush_lines;
      const dark = lines !== undefined ? lines(rng, nd) : fan(rng, poly, light, nd, 0.6, 1.0);
      const pale = lines !== undefined ? lines(rng, np) : fan(rng, poly, light, np, 0.5, 0.98);
      if (o.simple !== true) {
        Brush.paint(pt, rng, dark, pale, size, info, cfg);
        variegate(pt, rng, poly, size, info, o.lifts ?? 1);
      }
    } else {
      pt.fill(body, pig, Math.min(0.95, 0.85 * s), { blend: "multiply" });
      pt.clipBegin(body);
      // Many faint layers read as a gradient; few strong ones read as rings.
      const rings = o.rings ?? 12;
      for (let k = 1; k <= rings; k++) {
        const sc = 1 - (k / (rings + 1)) ** 0.75 * 0.97;
        const layer = G.deform(G.toward(poly, light[0], light[1], sc), rng, size * 0.018 * sc);
        pt.fill(G.smooth(layer, true), PAL.white, o.lift ?? 0.10);
      }
    }

    // The wet edge: pigment pools at the rim, heaviest toward the tip.
    const ramped = o.ramp !== undefined;
    if (runs !== undefined) {
      pt.fillMany(bands(runs[0], size * 0.08, 0.2), pool, (ramped ? 0.12 : 0.16) * s, { blend: "multiply" });
      pt.fillMany(bands(runs[0], size * 0.025, 0.2), pool, (ramped ? 0.26 : 0.30) * s, { blend: "multiply" });
    } else {
      pt.stroke(body, pool, size * 0.16, (ramped ? 0.12 : 0.16) * s, { blend: "multiply" });
      pt.stroke(body, pool, size * 0.05, (ramped ? 0.26 : 0.30) * s, { blend: "multiply" });
    }

    const streaks = Math.floor((o.streaks ?? 0) * (ramped ? cfg.streak_scale : 1));
    if (streaks > 0) {
      const lines = fan(rng, poly, light, streaks);
      const half = Math.floor(lines.length / 2);
      hairlines(pt, lines.slice(0, half), PAL.white, size * 0.022, 0.75);
      hairlines(pt, lines.slice(half), PAL.white, size * 0.013, 0.55);
    }
    // Rays: fine white lines fanning from the light point (a flower's eye)
    // partway along the shape, each third with its own contrast.
    const rays = o.rays;
    if (rays !== undefined && rays.count > 0) {
      const lines = fan(rng, poly, light, rays.count, rays.reach[0], rays.reach[1]);
      const lo = rays.contrast[0], hi = rays.contrast[1];
      const thirds = Math.max(1, Math.floor(lines.length / 3));
      for (let k = 0; k <= 2; k++) {
        const part3 = lines.slice(k * thirds, k === 2 ? lines.length : (k + 1) * thirds);
        hairlines(pt, part3, PAL.white, size * (0.007 + 0.004 * k), lo + ((hi - lo) * k) / 2);
      }
    }
    if ((o.dark_streaks ?? 0) > 0) {
      const lines = fan(rng, poly, light, o.dark_streaks ?? 0, 0.4, 0.98);
      hairlines(pt, lines, pool, size * 0.010, cfg.vein_opacity * s, { blend: "multiply" });
    }

    if (o.inner !== undefined) o.inner(pt);

    if ((o.grain ?? 0) > 0) {
      grain(pt, rng, poly, o.grain ?? 0, {
        scale: o.grain_scale ?? 1, dark_op: 0.30 * s + 0.08,
        clump: cfg.grain_clump, mottle: cfg.grain_mottle, dark_rgb: grainRgb,
      });
    }

    // Lost edges: the wash fades into the paper through faint, uneven layers
    // that reach in from the contour, so the white of the page runs into the
    // shape without a boundary of its own.
    if (runs !== undefined && cfg.lost_fade > 0) {
      // Depth follows the shape's thickness (2 area / perimeter, about the
      // width of a thin blade), not its length, so a long leaf keeps its body.
      const ring = poly.slice();
      ring.push(poly[0]);
      const thick = (2 * Math.abs(G.area(poly))) / Math.max(1e-9, G.length(ring));
      const d = Math.min(size, 1.6 * thick) * cfg.lost_fade * (o.fade_scale ?? 1);
      // With eye_fade (0-1) the fade narrows away from the pale end, so a
      // petal pales toward its eye and keeps its blue up the sides and tip.
      const ef = o.eye_fade ?? 0;
      const scaleAt = ef > 0 ? (p: Pt) => 1 - ef + ef * G.smoothstep(0.35, 0.9, paleAt(p)) : undefined;
      const layers = o.simple === true ? 3 : 7;
      for (let k = 1; k <= layers; k++) {
        const w = d * (0.36 - (0.045 * (k - 1) * 7) / layers);
        pt.fillMany(bands(runs[1], w, 0.4 - 0.03 * k, erng, w * 0.25, scaleAt), PAL.white, 0.22);
      }
    }

    pt.clipEnd();
  });

  if ((o.outline ?? 0) > 0) {
    layLine(() => {
      if (runs !== undefined) {
        pt.fillMany(bands(runs[0], (o.outline_w ?? 0.28) / 2, 0.25), line, o.outline ?? 0, { blend: "multiply" });
      } else {
        pt.stroke(body, line, o.outline_w ?? 0.28, o.outline ?? 0, { blend: "multiply" });
      }
    });
  }
}

// Closed outline `poly` as a polyline that starts and ends at its point
// nearest `p`, the way a pen traces a contour from the base round.
export function ringFrom(poly: readonly Pt[], p: Pt): Pt[] {
  let i0 = 0, best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = G.dist(poly[i], p);
    if (d < best) {
      best = d;
      i0 = i;
    }
  }
  const out: Pt[] = [];
  for (let j = 0; j <= poly.length; j++) out.push(poly[mod(i0 + j, poly.length)]);
  return out;
}
