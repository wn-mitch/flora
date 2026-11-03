// Line-work plants: stems, tendrils, umbels, forget-me-not cymes and
// baby's-breath sprays. Strokes are collected into width buckets and
// painted in a few batched fills.
import { mod } from "#platform";
import * as C from "./color.ts";
import type { RGB } from "./color.ts";
import { sample } from "./dist.ts";
import { bud, florets, type Floret } from "./flower.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import type { Leaflet } from "./leaf.ts";
import { PAL, type Clock, type Painter } from "./paint.ts";
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

// Collects stems and florets, then paints them in batches.
export class Batch {
  ribbons: Cmd[][] = [];
  lines: Cmd[][][] = [[], [], []];
  florets: Floret[] = [];
  buds: Bud[] = [];
  stars: Star[] = [];

  // A tapered stem from w0 to w1 (full widths, pt), filled as a ribbon.
  stem(pts: readonly Pt[], w0: number, w1: number): void {
    this.ribbons.push(G.smooth(G.ribbon(pts, (t) => (w0 + (w1 - w0) * t) / 2), true));
  }

  // A stem whose full width at fraction t is w(t).
  stemBy(pts: readonly Pt[], w: (t: number) => number): void {
    this.ribbons.push(G.smooth(G.ribbon(pts, (t) => w(t) / 2), true));
  }

  // A hairline; `cls` 1-3 selects 0.32, 0.22 or 0.14 pt.
  line(pts: readonly Pt[], cls: 1 | 2 | 3 = 2): void {
    this.lines[cls - 1].push(G.smooth(pts, false));
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
    for (let i = 0; i < 3; i++) for (const c of other.lines[i]) this.lines[i].push(c);
    for (const f of other.florets) this.florets.push(f);
    for (const b of other.buds) this.buds.push(b);
    for (const s of other.stars) this.stars.push(s);
  }

  // Only the items already born on growth clock `clock`: each pops in when
  // the front reaches its first point.
  born(clock: Clock): Batch {
    const b = new Batch();
    const first = (c: readonly Cmd[]) => {
      const op = c[0];
      return op !== undefined && op[0] !== "z" && clock.born(op[1], op[2]);
    };
    for (const c of this.ribbons) if (first(c)) b.ribbons.push(c);
    for (let i = 0; i < 3; i++) for (const c of this.lines[i]) if (first(c)) b.lines[i].push(c);
    for (const f of this.florets) if (clock.born(f.x, f.y)) b.florets.push(f);
    for (const d of this.buds) if (clock.born(d.x, d.y)) b.buds.push(d);
    for (const s of this.stars) if (clock.born(s.x, s.y)) b.stars.push(s);
    return b;
  }

  // Paint everything collected in `ink` (navy by default), recoloured by
  // the palette's sprays; under the painter's clock, only what is born.
  paint(pt: Painter, ink: RGB = PAL.ink): void {
    const clock = pt.clock;
    if (clock !== undefined) {
      pt.clock = undefined;
      this.born(clock).paint(pt, ink);
      pt.clock = clock;
      return;
    }
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
