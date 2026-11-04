// Line-work plants: stems, tendrils, umbels, forget-me-not cymes and
// baby's-breath sprays. Strokes are collected into width buckets and
// painted in a few batched fills.
import { mod, sortNumbers } from "#platform";
import * as C from "./color.ts";
import type { RGB } from "./color.ts";
import { sample } from "./dist.ts";
import { bud, florets, type Floret } from "./flower.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import type { Leaflet } from "./leaf.ts";
import { PAL, type Lay, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";
import { SIZES } from "./tune.ts";

const PI = Math.PI;

// Hairline widths by class 1-3, pt.
const WIDTHS = [0.32, 0.22, 0.14];

interface Bud {
  readonly x: number;
  readonly y: number;
  readonly ang: number;
  readonly len: number;
}
interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

// Growth a floret, bud or star takes to open, per pt of its size.
const OPEN = 3;
// A timed batch's parts each hold what starts within this much growth.
const BUCKET = 16;

// Collects stems and florets, then paints them in batches.
export class Batch {
  ribbons: Cmd[][] = [];
  lines: Cmd[][][] = [[], [], []];
  // Each ribbon's and line's centreline and half width, which the pen
  // follows as it lays them down.
  spines: [Pt[], number][] = [];
  lineSpines: Pt[][][] = [[], [], []];
  florets: Floret[] = [];
  buds: Bud[] = [];
  stars: Star[] = [];

  // A tapered stem from w0 to w1 (full widths, pt), filled as a ribbon.
  stem(pts: readonly Pt[], w0: number, w1: number): void {
    this.ribbons.push(G.smooth(G.ribbon(pts, (t) => (w0 + (w1 - w0) * t) / 2), true));
    this.spines.push([pts.slice(), Math.max(w0, w1) / 2]);
  }

  // A stem whose full width at fraction t is w(t).
  stemBy(pts: readonly Pt[], w: (t: number) => number): void {
    this.ribbons.push(G.smooth(G.ribbon(pts, (t) => w(t) / 2), true));
    let wmax = 0;
    for (let i = 0; i <= 10; i++) wmax = Math.max(wmax, w(i / 10));
    this.spines.push([pts.slice(), wmax / 2]);
  }

  // A hairline; `cls` 1-3 selects 0.32, 0.22 or 0.14 pt.
  line(pts: readonly Pt[], cls: 1 | 2 | 3 = 2): void {
    this.lines[cls - 1].push(G.smooth(pts, false));
    this.lineSpines[cls - 1].push(pts.slice());
  }

  // A five-petalled floret; `soft` paints it as baby's breath (flower.ts
  // florets).
  floret(x: number, y: number, r: number, rot: number, tint: 1 | 2 | 3, soft = false): void {
    this.florets.push({ x, y, r, rot, tint, soft });
  }

  bud(x: number, y: number, ang: number, len: number): void {
    this.buds.push({ x, y, ang, len });
  }

  // Four-point sparkle used as a floret substitute in the sprays.
  star(x: number, y: number, r: number): void {
    this.stars.push({ x, y, r });
  }

  // Calls fn(x, y, r) for every vertex (r = 0) and every floret, bud and
  // star (r = its radius or length), so callers can check a spray's extent.
  eachPoint(fn: (x: number, y: number, r: number) => void): void {
    const cmds = (list: readonly Cmd[][]) => {
      for (const c of list) {
        for (const op of c) {
          if (op[0] === "m" || op[0] === "l") fn(op[1], op[2], 0);
          else if (op[0] === "c") fn(op[5], op[6], 0);
        }
      }
    };
    cmds(this.ribbons);
    for (const l of this.lines) cmds(l);
    for (const f of this.florets) fn(f.x, f.y, f.r);
    for (const b of this.buds) fn(b.x, b.y, b.len);
    for (const s of this.stars) fn(s.x, s.y, s.r);
  }

  // Append everything collected in `other`.
  merge(other: Batch): void {
    for (const c of other.ribbons) this.ribbons.push(c);
    for (const c of other.spines) this.spines.push(c);
    for (let i = 0; i < 3; i++) for (const c of other.lines[i]) this.lines[i].push(c);
    for (let i = 0; i < 3; i++) for (const c of other.lineSpines[i]) this.lineSpines[i].push(c);
    for (const f of other.florets) this.florets.push(f);
    for (const b of other.buds) this.buds.push(b);
    for (const s of other.stars) this.stars.push(s);
  }

  // How the pen lays the batch down: along each stem and line from where
  // it starts, and each floret, bud and star opening from its middle.
  lays(): Lay[] {
    const out: Lay[] = [];
    for (const [pts, half] of this.spines) if (pts.length > 0) out.push({ at: pts[0], along: pts, half: half + 1 });
    for (let i = 0; i < 3; i++) {
      for (const pts of this.lineSpines[i]) if (pts.length > 0) out.push({ at: pts[0], along: pts, half: WIDTHS[i] + 1 });
    }
    for (const f of this.florets) out.push({ at: [f.x, f.y], from: [f.x, f.y], reach: f.r * 1.6 + 1, dur: OPEN * f.r });
    for (const d of this.buds) out.push({ at: [d.x, d.y], from: [d.x, d.y], reach: d.len * 1.3 + 1, dur: OPEN * d.len });
    for (const st of this.stars) out.push({ at: [st.x, st.y], from: [st.x, st.y], reach: st.r * 1.2 + 1, dur: OPEN * st.r });
    return out;
  }

  // Paint everything collected in `ink` (navy by default), recoloured by
  // the palette's sprays, laid down as lays() describes.
  //
  // Keeping the timeline, the batch is also painted in parts, each holding
  // what starts within the same BUCKET of growth, so a frame clips only the
  // few parts being laid down; once every part is, the frame shows the
  // batch painted whole, as without the timeline.
  paint(pt: Painter, ink: RGB = PAL.ink): void {
    const lays = this.lays();
    if (lays.length === 0) return;
    const births = pt.births;
    if (!pt.timed || births === undefined) {
      pt.lay(lays, () => this.paintAll(pt, ink));
      return;
    }
    const parts = new Map<number, Batch>();
    const part = (p: Pt): Batch => {
      const k = Math.floor(births(p[0], p[1]) / BUCKET);
      let b = parts.get(k);
      if (b === undefined) {
        b = new Batch();
        parts.set(k, b);
      }
      return b;
    };
    for (let i = 0; i < this.spines.length; i++) {
      const sp = this.spines[i];
      if (sp[0].length === 0) continue;
      const b = part(sp[0][0]);
      b.ribbons.push(this.ribbons[i]);
      b.spines.push(sp);
    }
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < this.lineSpines[c].length; i++) {
        const sp = this.lineSpines[c][i];
        if (sp.length === 0) continue;
        const b = part(sp[0]);
        b.lines[c].push(this.lines[c][i]);
        b.lineSpines[c].push(sp);
      }
    }
    for (const f of this.florets) part([f.x, f.y]).florets.push(f);
    for (const d of this.buds) part([d.x, d.y]).buds.push(d);
    for (const st of this.stars) part([st.x, st.y]).stars.push(st);
    const keys: number[] = [];
    parts.forEach((_, k) => keys.push(k));
    sortNumbers(keys);
    pt.batched(keys.map((k) => {
      const b = parts.get(k) as Batch;
      return { lays: b.lays(), paint: () => b.paintAll(pt, ink) };
    }), () => this.paintAll(pt, ink));
  }

  private paintAll(pt: Painter, ink: RGB): void {
    const tint = C.partInk("sprays", pt.palette);
    const col = C.recolor(ink, tint);
    if (this.ribbons.length > 0) pt.fillMany(this.ribbons, col, 0.92, { blend: "multiply" });
    for (let i = 0; i < 3; i++) {
      if (this.lines[i].length > 0) pt.strokeMany(this.lines[i], col, WIDTHS[i], 0.85, { blend: "multiply" });
    }
    const deep = C.recolor(PAL.deep, tint);
    for (const b of this.buds) bud(pt, b.x, b.y, b.ang, b.len, deep);
    if (this.florets.length > 0) florets(pt, this.florets);
    if (this.stars.length > 0) {
      const paths: Cmd[][] = this.stars.map(({ x, y, r }): Cmd[] => {
        const k = r * 0.22;
        return [
          ["m", x, y + r], ["l", x + k, y + k], ["l", x + r, y], ["l", x + k, y - k],
          ["l", x, y - r], ["l", x - k, y - k], ["l", x - r, y], ["l", x - k, y + k], ["z"],
        ];
      });
      pt.fillMany(paths, deep, 0.85, { blend: "multiply" });
    }
  }
}

// A tendril: a gentle arc whose curvature rises as t^2.5, so it winds into
// a volute of a little over a turn without a seam. The innermost turn is held
// to a 4 pt radius so the eye of the volute stays open and round, as the
// reference's curls are.
export function tendril(p: Pt, ang: number, len: number, dir: number): Pt[] {
  const c = G.curlCoefficient(len, 1.05, 2.5);
  return G.flow(p, ang, len, (t) => dir * Math.min(0.25 / len + c * t ** 2.5, 1 / 4))[0];
}

// A flourish: the stem swings through one open loop, straightens, then
// curls the other way into a volute, the cursive figure the margin
// ornament is built from.
export function flourish(p: Pt, ang: number, len: number, dir: number): Pt[] {
  const split = 0.55;
  const loop = (2 * PI * 1.05 * 2) / (split * len); // sin^2 averages 1/2
  const curl = G.curlCoefficient((1 - split) * len, 1.2, 2.5);
  return G.flow(p, ang, len, (t) => {
    if (t < split) return dir * loop * Math.sin((PI * t) / split) ** 2;
    return -dir * Math.min(curl * ((t - split) / (1 - split)) ** 2.5, 1 / 4);
  })[0];
}

// Queen Anne's lace: rays from one point forming a dome of umbellets.
export function umbel(b: Batch, rng: Rng, base: Pt, ang: number, R: number): void {
  const m = rng.int(13, 19);
  const spread = rng.range(2.0, 2.6);
  for (let j = 0; j < m; j++) {
    const u = (j + 0.5) / m;
    const a = ang - spread / 2 + spread * u + rng.jit(0.05);
    const len = R * (0.72 + 0.28 * Math.cos((u - 0.5) * PI)) * rng.range(0.9, 1.05);
    const ray = G.curve(base, a, len, (u - 0.5) * 0.35, 0, 6);
    b.line(ray, 3);
    const tip = ray[ray.length - 1];
    const k = rng.int(4, 7);
    for (let i = 0; i < k; i++) {
      const a2 = a - 1.1 + (2.2 * (i + 0.5)) / k + rng.jit(0.08);
      const sub = G.curve(tip, a2, R * rng.range(0.13, 0.22), rng.jit(0.3), 0, 3);
      b.line(sub, 3);
      const e = sub[sub.length - 1];
      b.floret(e[0], e[1], R * rng.range(0.020, 0.030), rng.range(0, 2 * PI), rng.chance(0.6) ? 2 : 3);
    }
  }
}

// A scorpioid cyme (forget-me-not): an axis that coils at its tip, with
// florets shrinking toward the coil and buds inside it. Returns the axis.
export function cyme(b: Batch, rng: Rng, base: Pt, ang: number, len: number, dir: number): Pt[] {
  const axis = tendril(base, ang, len, dir);
  b.line(axis, 2);
  const n = axis.length;
  const count = rng.int(7, 11);
  for (let i = 1; i <= count; i++) {
    const t = (i - 0.5) / count;
    // The 1-based point index of the Lua original, at least 2.
    const idx = Math.max(2, Math.floor(t * (n - 1)) + 1);
    const p = axis[idx - 2], q = axis[idx - 1];
    const a = G.angle(p, q) + (mod(i, 2) === 0 ? 1 : -1) * rng.range(0.6, 1.1);
    const size = len * 0.075 * (1.15 - 0.8 * t);
    const ped = G.curve(q, a, size * 1.4, rng.jit(0.4), 0, 3);
    b.line(ped, 3);
    const e = ped[ped.length - 1];
    if (t < 0.72) b.floret(e[0], e[1], size, rng.range(0, 2 * PI), rng.chance(0.35) ? 3 : 2);
    else b.bud(e[0], e[1], a, size * 1.5);
  }
  return axis;
}

// Tints of baby's breath florets, by weight: deep rarely, mostly pale.
const GYPS_TINT: Readonly<Record<string, number>> = { "1": 0.4, "2": 3, "3": 5 };
const TINT: Readonly<Record<string, 1 | 2 | 3>> = { "1": 1, "2": 2, "3": 3 };

// Baby's breath: a recursive dichasium that ends in clouds of tiny
// florets. Forks get wider and stalks shorter toward the tips, so the
// spray opens into a dome; one or two florets per tip keep the cloud open.
export function gypsophila(b: Batch, rng: Rng, base: Pt, ang: number, len: number, depth: number): void {
  const branch = (p: Pt, a: number, l: number, d: number): void => {
    const pts = G.curve(p, a, l, rng.jit(0.3), 0, 4);
    b.line(pts, d >= depth - 1 ? 2 : 3);
    const e = pts[pts.length - 1];
    const ea = G.angle(pts[pts.length - 2], e);
    if (d === 0) {
      // Mostly one soft floret per tip, mid-blue to pale, so the cloud
      // stays open; an occasional tiny star.
      const n = rng.chance(0.7) ? 1 : 2;
      for (let k = 1; k <= n; k++) {
        const q = k === 1 ? e : G.polar(e, ea + rng.jit(1.6), rng.range(2.8, 3.8));
        if (rng.chance(0.08)) b.star(q[0], q[1], rng.range(0.7, 1.1));
        else b.floret(q[0], q[1], rng.range(0.9, 1.5), rng.range(0, 2 * PI), TINT[rng.weighted(GYPS_TINT) ?? "3"], true);
      }
      return;
    }
    const spread = 0.25 + 0.45 * (1 - d / depth);
    const kids = rng.chance(0.4) ? 3 : 2;
    for (let k = 1; k <= kids; k++) {
      const off = kids === 2 ? (k === 1 ? -1 : 1) * spread * rng.range(0.7, 1.2) : (k - 2) * spread * rng.range(0.8, 1.2);
      branch(e, ea + off, l * rng.range(0.55, 0.72), d - 1);
    }
    if (d <= 2 && rng.chance(0.5)) {
      const q = G.polar(G.mix(p, e, 0.6), ea + rng.jit(1.2), rng.range(1.5, 2.5));
      b.floret(q[0], q[1], rng.range(0.5, 0.8), 0, 3, true);
    }
  };
  branch(base, ang, len, depth);
}

// Paired leaflets along a stem, as items for leaf.ts leaflets, sized from
// SIZES.leaflet around `len`. `every` is the gap between leaflets in pt,
// or a [min, max] range picked per gap.
export function leafletItems(rng: Rng, pts: readonly Pt[], every: number | readonly [number, number], len: number): Leaflet[] {
  const items: Leaflet[] = [];
  const L = G.length(pts);
  const lo = typeof every === "number" ? every : every[0];
  const hi = typeof every === "number" ? every : every[1];
  let d = 0;
  for (let i = 1; ; i++) {
    d += rng.range(lo, hi);
    if (d > L - lo * 0.3) break;
    const [p, a] = G.at(pts, (d + rng.jit(0.2) * lo) / L);
    const side = mod(i, 2) === 0 ? 1 : -1;
    items.push([p[0], p[1], a + side * rng.range(0.5, 0.9), len * sample(rng, SIZES.leaflet)]);
  }
  return items;
}
