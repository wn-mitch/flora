// The border as one plant. It is rooted at the right end of the foot; the
// main stem runs left along the foot, turns the corner on a wide arc,
// climbs the margin along the line of action (layout.ts gesture) and ends
// under the hero bloom. Everything else grows off it: long shoots leave the
// main stem low, climb with it, crossing it as they go, and end in a curl;
// shorter shoots carry each bloom, umbel and leaf. No shoot ends bare.
// Stems are grown by steering (geom.ts pursue), so their curvature builds
// and relaxes smoothly, and they thin at every fork: a parent keeps the
// share of its section that its child does not take (the pipe model,
// w^2 = w1^2 + w2^2).
import { fmt, mod } from "#platform";
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import type { Rng } from "./rng.ts";
import { PLANT } from "./tune.ts";

const PI = Math.PI;

// A rectangle [x0, y0, x1, y1] the stems keep clear of (the cartouche).
export type Rect = readonly [number, number, number, number];
// The hero bloom: its centre and radius.
export type Hero = readonly [number, number, number];

// The growing region (layout.ts region): the margin column x0-x1 from y0
// up to y1, and the foot band below `foot`.
export interface Region {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly foot: number;
  // A bare frame is a band along a curve, with no foot for the main stem
  // to run along.
  readonly bare?: boolean;
  // How far up a gathered stem (a bouquet's) runs from the frame's outer
  // edge before it leaves for its line of action.
  readonly gather?: number;
}

// One inward bow of the line of action: its height, reach and half-width.
export interface Bow {
  readonly y: number;
  readonly amp: number;
  readonly h: number;
}

// The border's line of action (layout.ts gesture).
export interface Gesture {
  readonly edge: number;
  readonly bows: readonly Bow[];
  readonly quiet: readonly number[];
  // Inward offset of the line of action at height y, the bows shifted by
  // dy and each scaled by gain[i].
  readonly bow: (this: void, y: number, dy?: number, gain?: readonly number[]) => number;
  // How densely the border grows at (x, y), from the floor to 1.
  readonly density: (this: void, x: number, y: number) => number;
}

export interface Fork {
  readonly s: number;
  readonly keep: number;
}

// A stem: its points, cumulative lengths, and width from w0 at its base to
// w1 at its tip before forks take their share.
export interface Stem {
  readonly pts: Pt[];
  readonly cum: number[];
  readonly len: number;
  readonly w0: number;
  readonly w1: number;
  readonly forks: Fork[];
  // Full width at fraction t; reads the forks when called, so shoots added
  // later still narrow it.
  readonly width: (this: void, t: number) => number;
  min?: number;
  main?: boolean;
  kind?: "crown" | "long" | "foot";
  // Point and heading of the tip, left for compose to finish.
  tip?: [Pt, number];
}

// Push point q right of rectangle `box`, fully from 12 pt before the box
// to 12 pt after it and easing over `ease` pt beyond, so a stem steering
// along the pushed guide bends around the box instead of cutting into it.
// Wider swings need a longer ease.
function clearOf(box: Rect | undefined, q: Pt, gap: number, ease = 60): Pt {
  if (box === undefined) return q;
  const push = G.smoothstep(box[1] - 12 - ease, box[1] - 12, q[1]) * (1 - G.smoothstep(box[3] + 12, box[3] + 12 + ease, q[1]));
  const need = box[2] + gap - q[0];
  if (need <= 0 || push <= 0) return q;
  return [q[0] + need * push, q[1]];
}

export function stem(pts: Pt[], w0: number, w1: number): Stem {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += G.dist(pts[i - 1], pts[i]);
    cum.push(total);
  }
  const len = Math.max(total, 1e-9);
  const st: Stem = { pts, cum, len, w0, w1, forks: [], width: (t) => widthAt(st, t * len) };
  return st;
}

// Full width of stem `st` at arc length s, after the forks below s.
export function widthAt(st: Stem, s: number): number {
  const t = G.clamp(s / st.len, 0, 1);
  let w = st.w0 + (st.w1 - st.w0) * t;
  for (const f of st.forks) {
    // Each fork narrows the parent over a few points rather than in a step.
    const u = G.smoothstep(f.s - 2, f.s + 6, s);
    w = w * (1 - u + u * f.keep);
  }
  return Math.max(w, st.min ?? 0.35);
}

// Record a child of full width `cw` leaving `st` at fraction t; returns
// the parent's width there. The parent keeps sqrt(1 - (cw/w)^2) of its
// width beyond the fork, at least `floor` of it.
export function fork(st: Stem, t: number, cw: number, floor = 0.82): number {
  const s = t * st.len;
  const w = widthAt(st, s);
  const r = G.clamp(cw / w, 0, 0.95);
  st.forks.push({ s, keep: Math.max(floor, Math.sqrt(1 - r * r)) });
  return w;
}

// Point and heading of `st` at arc length s, and the index of the point
// past it.
export function at(st: Stem, s: number): [Pt, number, number] {
  s = G.clamp(s, 0, st.len);
  const pts = st.pts, cum = st.cum;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const u = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  return [G.mix(a, b, u), G.angle(a, b), i];
}

type Target = (q: Pt, s: number, a: number) => Pt | undefined;

// Wrap target function `follow` so a stem steers clear of rectangle `box`.
// A stem cannot reverse a bend at once, so it looks ahead: when its heading
// would carry it into the box within 100 pt (about the distance it needs
// to move aside under its bend limits), it steers for a point clear of the
// box's inner side instead.
function avoiding(follow: Target, box: Rect | undefined): Target {
  if (box === undefined) return follow;
  return (q, s, a) => {
    const t = follow(q, s, a);
    if (t === undefined) return undefined;
    for (const d of [15, 35, 60, 100]) {
      const f = G.polar(q, a, d);
      if (f[0] < box[2] + 6 && f[1] > box[1] - 6 && f[1] < box[3] + 6) return [box[2] + 16, f[1] + 10];
    }
    return t;
  };
}

// The main stem's guide: the foot run from the root, the corner arc, then
// the line of action up to the hero bloom's cap. The stem is steered along
// it rather than through it, so the guide's corners never show. Returns
// the guide, the corner and the cap.
function guide(rng: Rng, m: Region, hero: Hero, W: number, gest: Gesture, avoid: Rect | undefined): [Pt[], Pt, Pt] {
  const mw = m.x1 - m.x0;
  const R = mw * 0.32;
  const footy = m.y0 + 6;
  const xr = gest.edge;
  let riseY = footy + R;
  const pts: Pt[] = [];
  const period = rng.range(120, 170);
  if (m.bare === true) {
    // No foot: the stem rises from the root on its line, or from the
    // frame's outer edge when it is gathered there.
    riseY = footy;
    pts.push([m.gather !== undefined ? 0 : xr, footy]);
  } else {
    for (let x = W * PLANT.root; x > xr + R + 12; x -= 20) {
      const ramp = G.smoothstep(xr + R, xr + R + 60, x);
      pts.push([x, footy + 4 * ramp * Math.sin(1 + (2 * PI * x) / period)]);
    }
    for (let i = 0; i <= 10; i++) {
      const th = -PI / 2 - ((PI / 2) * i) / 10;
      pts.push([xr + R + R * Math.cos(th), riseY + R * Math.sin(th)]);
    }
  }
  const swayLen = rng.range(300, 400);
  const amp = mw * rng.range(0.015, 0.03);
  const cap: Pt = [hero[0] - hero[2] * 0.1, hero[1] - hero[2] * 0.15];
  const pullFrom = cap[1] - Math.max(hero[2] * 2.4, 90);
  for (let y = riseY + 16; y < cap[1] - 12; y += 12) {
    const ramp = G.smoothstep(riseY, riseY + 80, y);
    const sway = Math.sin((2 * PI * (y - riseY)) / swayLen);
    let gx = xr + ramp * (amp * sway + gest.bow(y, 0));
    gx = gx + (cap[0] - gx) * G.smoothstep(pullFrom, cap[1], y);
    if (m.gather !== undefined) gx = gx * G.smoothstep(riseY - m.gather * 0.2, riseY + m.gather, y);
    pts.push(clearOf(avoid, [gx, y], 9));
  }
  pts.push(cap);
  return [pts, [xr, riseY], cap];
}

// Grow the main stem, around rectangle `avoid` if given. Returns the stem,
// the corner point (where the rise begins) and the cap under the hero.
export function main(rng: Rng, m: Region, hero: Hero, W: number, gest: Gesture, avoid?: Rect): [Stem, Pt, Pt] {
  const cfg = PLANT;
  const [gpts, corner, cap] = guide(rng, m, hero, W, gest, avoid);
  const kmax = 1 / cfg.bend_radius;
  const targetAt = avoiding(G.follow(gpts, cfg.lookahead, 14), avoid);
  const [pts] = G.pursue(gpts[0], G.angle(gpts[0], gpts[1]), targetAt, {
    len: G.length(gpts) * 1.3, kmax, dk: kmax / cfg.bend_ease, step: 2,
  });
  // The last stretch arrives at the cap heading for the bloom's centre, so
  // the stem meets the hero from below whatever its heading was.
  const tail = pts[pts.length - 1];
  const a = G.angle(pts[pts.length - 2], tail);
  const link = G.link(tail, a, cap, G.angle(cap, [hero[0], hero[1]]), 0.45);
  for (let i = 1; i < link.length; i++) pts.push(link[i]);
  const st = stem(pts, cfg.root_width, cfg.root_width * 0.8);
  st.main = true;
  st.min = cfg.tip_width;
  return [st, corner, cap];
}

// The hero's crown: two shoots that leave the main stem well below the
// hero, cross over it, and climb the opposite side, ending under the rim
// of its petals. Crossing each other and the main stem, they weave the
// intertwined stems the reference shows under its hero; leaves and sprays
// spill out around the hero from them (blooms paint over foliage). Each
// shoot's tip is left for compose to finish.
export function crown(rng: Rng, mainStem: Stem, m: Region, hero: Hero): Stem[] {
  const cfg = PLANT;
  const R = hero[2];
  const centre: Pt = [hero[0], hero[1]];
  let s0 = mainStem.len;
  for (let s = mainStem.len; s >= 0; s -= 2) {
    if (at(mainStem, s)[0][1] < hero[1] - R * 1.5) {
      s0 = s;
      break;
    }
  }
  const out: Stem[] = [];
  const sides = [-1, 1];
  for (let k = 0; k < sides.length; k++) {
    const side = sides[k];
    const r = rng.fork("crown" + fmt(k + 1, 0));
    const s = Math.max(0, s0 - r.range(0, R * 0.9));
    const [p0, a0] = at(mainStem, s);
    // The tip sits under the petals' rim, low on the hero's flank.
    const ta = (side < 0 ? PI : 0) - side * r.range(0.15, 0.55);
    const to = G.polar(centre, ta, R * r.range(0.85, 0.95));
    to[0] = G.clamp(to[0], m.x0 + 4, m.x1 - 4);
    // Leave toward the far side, so the shoot crosses the main stem, and
    // arrive heading up and out, so the last control point sits below and
    // outside the rim and the curve keeps off the bloom's heart.
    const pts = G.link(p0, a0 - side * 0.55, to, PI / 2 - side * 0.5, 0.6);
    const clear = !pts.some((q) => G.dist(q, centre) < R * 0.7);
    if (clear && pts.length >= 6) {
      const w = fork(mainStem, s / mainStem.len, cfg.root_width * cfg.fork_ratio * 0.6, 0.75);
      const st = stem(pts, w * 0.7, 0.35);
      st.min = 0.3;
      st.kind = "crown";
      st.tip = [pts[pts.length - 1], G.angle(pts[pts.length - 2], pts[pts.length - 1])];
      out.push(st);
    }
  }
  return out;
}

// Long shoots: each leaves the main stem low, runs with it while weaving
// across it on a slow wave, then over its last third veers off into the
// roomier side of the margin. Its tip is left for compose to finish with a
// leaf or a spray. They follow the main stem's own path, offset across it,
// swinging widest within the gesture's bows and staying close in the quiet
// stretches, which keep room for the cartouche.
export function longShoots(rng: Rng, mainStem: Stem, m: Region, hero: Hero, gest: Gesture, avoid?: Rect): Stem[] {
  const cfg = PLANT;
  const mw = m.x1 - m.x0;
  const out: Stem[] = [];
  let bowMax = 1e-9;
  for (const b of gest.bows) bowMax = Math.max(bowMax, b.amp);
  // The rise: from where the main stem leaves the foot to just below the
  // hero. The run along the foot is excluded, so shoot ends are spread up
  // the margin rather than bunched low.
  let rise0 = mainStem.len;
  for (let s = 0; s <= mainStem.len; s += 4) {
    if (at(mainStem, s)[0][1] > m.y0 + mw * 0.5) {
      rise0 = s;
      break;
    }
  }
  let rise1 = mainStem.len;
  for (let s = mainStem.len; s >= 0; s -= 4) {
    if (at(mainStem, s)[0][1] < hero[1] - hero[2] * 0.7) {
      rise1 = s;
      break;
    }
  }
  const span = Math.max(1, rise1 - rise0);
  const n = cfg.long_shoots;
  for (let k = 1; k <= n; k++) {
    const r = rng.fork("long" + fmt(k, 0));
    // Leave within PLANT.shoot_start of the rise; end at heights spread
    // evenly over PLANT.shoot_end of it.
    const ss = cfg.shoot_start, se = cfg.shoot_end;
    const s0 = Math.max(mainStem.len * 0.15, rise0 + span * r.range(ss[0], ss[1]));
    const f = G.clamp((k - 0.5 + r.jit(0.3)) / n + 0.5 / n, 0, 1);
    // At least 60 pt of shoot, and never past the top of the rise.
    const s1 = Math.min(rise1, Math.max(s0 + 60, rise0 + span * (se[0] + (se[1] - se[0]) * f)));
    const A = mw * r.range(cfg.shoot_reach[0], cfg.shoot_reach[1]);
    const wave = r.range(cfg.shoot_wave[0], cfg.shoot_wave[1]);
    const side = mod(k, 2) === 0 ? 1 : -1;
    const ph = r.range(0, 0.5);
    // The veer goes toward whichever side of the main stem has more room
    // where it begins; +1 is the stem's left (the outer edge on the rise).
    const pv = at(mainStem, s0 + (s1 - s0) * 0.65)[0];
    const veer = pv[0] - m.x0 > m.x1 - pv[0] ? 1 : -1;
    const gpts: Pt[] = [];
    for (let s = s0 + 6; s <= s1; s += 8) {
      const [p, a] = at(mainStem, s);
      const u = s - s0;
      const env = 0.5 + 0.5 * G.clamp(gest.bow(p[1], 0) / bowMax, 0, 1);
      let off = side * A * env * G.smoothstep(0, 50, u) * Math.sin(2 * PI * (ph + u / wave));
      off = off + veer * A * 1.4 * G.smoothstep(0.65, 1, u / (s1 - s0));
      // Offsets are horizontal, scaled by how upright the main stem runs:
      // shifting a wide swing along the stem's normal would fold the guide
      // into loops on the inside of the main stem's bows. Along the foot
      // the shoot runs with the main stem.
      const upright = G.smoothstep(0.3, 0.7, Math.abs(Math.sin(a)));
      const dx = (Math.cos(a + PI / 2) >= 0 ? 1 : -1) * off * upright;
      const q = clearOf(avoid, [p[0] + dx, p[1]], 6, 150);
      gpts.push([G.clamp(q[0], m.x0 + 6, m.x1 - 6), q[1]]);
    }
    if (gpts.length >= 4) {
      const [p0, a0] = at(mainStem, s0);
      const kmax = 1 / (cfg.bend_radius * 0.6);
      // A short lookahead, tied to the wave, so steering follows the swing
      // instead of cutting across it.
      const ahead = Math.min(cfg.lookahead * 0.7, wave * 0.12);
      const [pts, a] = G.pursue(p0, a0 + side * 0.08, avoiding(G.follow(gpts, ahead, 10), avoid), {
        len: (s1 - s0) * 1.3, kmax, dk: kmax / (cfg.bend_ease * 0.7), step: 2,
        // Steering may overshoot its guide; the shoot stops at the margin.
        stop: (q) => q[0] > m.x1 - 3 || q[0] < m.x0 + 2,
      });
      if (pts.length >= 6) {
        const w = fork(mainStem, s0 / mainStem.len, cfg.root_width * cfg.fork_ratio, 0.75);
        const st = stem(pts, w * cfg.fork_ratio, 0.35);
        st.min = 0.3;
        st.kind = "long";
        st.tip = [pts[pts.length - 1], a];
        out.push(st);
      }
    }
  }
  return out;
}

// Foot shoots: along the foot and around the corner the main stem puts out
// shoots that sweep up and back toward the corner, roughly parallel, so
// the corner fans out the way the reference's does. Each leaves
// tangentially and arcs up into the space between the foot and the text,
// stopping where it would meet the text block; its tip is left for a leaf
// or a spray.
export function footShoots(rng: Rng, mainStem: Stem, m: Region, corner: Pt, avoid?: Rect): Stem[] {
  const cfg = PLANT;
  const out: Stem[] = [];
  // The interior the shoots turn toward: up and in from the corner.
  const inside: Pt = [corner[0] + (m.x1 - m.x0) * 0.6, corner[1] + 60];
  const sEnd = mainStem.len * 0.3;
  for (let k = 1; k <= cfg.foot_shoots; k++) {
    const r = rng.fork("foot" + fmt(k, 0));
    const s0 = (sEnd * (k - 0.6 + r.jit(0.25))) / cfg.foot_shoots;
    const [p0, a0] = at(mainStem, s0);
    const nx = Math.cos(a0 + PI / 2), ny = Math.sin(a0 + PI / 2);
    const sign = nx * (inside[0] - p0[0]) + ny * (inside[1] - p0[1]) >= 0 ? 1 : -1;
    const len = r.range(cfg.foot_reach[0], cfg.foot_reach[1]);
    // Swept back along the main stem's growth, up toward the corner.
    const target = G.polar(p0, a0 + sign * r.range(0.55, 0.95), len);
    const kmax = 1 / cfg.shoot_bend;
    const [pts, a] = G.pursue(p0, a0 + sign * 0.1, (q) => (G.dist(q, target) < 4 ? undefined : target), {
      len: len * 1.6, kmax, dk: kmax / 20, step: 1.5,
      stop: (q) =>
        (q[0] > m.x1 - 4 && q[1] > m.foot - 8) || q[0] < m.x0 + 3 || q[1] < m.y0 - 2 ||
        (avoid !== undefined && q[0] <= avoid[2] + 2 && q[1] >= avoid[1] - 2 && q[1] <= avoid[3] + 2),
    });
    if (pts.length >= 8) {
      const w = fork(mainStem, s0 / mainStem.len, 1.0, 0.9);
      const st = stem(pts, Math.min(1.1, w * 0.4), 0.3);
      st.min = 0.3;
      st.kind = "foot";
      st.tip = [pts[pts.length - 1], a];
      out.push(st);
    }
  }
  return out;
}

// A shoot from stem point `p` (stem heading `along`) to `target`, leaving
// tangentially and steering in; it stops `stopR` short of the target.
// Undefined if it cannot get there within its curvature limits.
export function shoot(p: Pt, along: number, target: Pt, stopR: number): Pt[] | undefined {
  const kmax = 1 / PLANT.shoot_bend;
  const d = G.dist(p, target);
  const [pts] = G.pursue(p, G.depart(p, along, target, 0.12), (q) => (G.dist(q, target) < stopR ? undefined : target), {
    len: d * 2.5 + 30, kmax, dk: kmax / 12, step: 1.5,
  });
  if (pts.length < 3 || G.dist(pts[pts.length - 1], target) > stopR + 3) return undefined;
  return pts;
}
