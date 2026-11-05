// A stem's growing tip (garden.ts runs them): it feels its way into open
// space as a slime mould's front does, but turned about, shunning what is
// already grown rather than following it. Each step it senses the room
// ahead and to either side (the clearance field, Space.room), the pull of
// the unclaimed points around it (space colonization), and the fall of the
// page, turns toward their sum with its bend held smooth (as geom.pursue
// does), and claims the stem it leaves behind. At nodes it puts out a leaf,
// a spray or a shoot of its own into whichever side has more room; when it
// runs out of room, length or food it ends, in a bloom where there is room
// for one.
import * as G from "../engine/geom.ts";
import type { Pt } from "../engine/geom.ts";
import type { Painter } from "../engine/paint.ts";
import { Rng } from "../engine/rng.ts";

// Pt a tip grows per step.
export const STEP = 2;
// How far ahead and how far to either side (radians) a tip senses.
const SENSE_AT = 24, SENSE_SIDE = 0.55;
// How far a tip steers toward, pt, for its bend (geom.pursue).
const LOOK = 30;
// Change in curvature per pt, 1/pt^2.
const DK = 1 / 600;
// The stretch just behind a tip it has not claimed yet, pt, so it is not
// hemmed in by its own stem; and the gap kept beside a stem, pt.
const LAG = 10, GAP = 4;
// How far a new tip grows before it heeds what is grown, pt: the stem it
// leaves is claimed.
const ESCAPE = 12;
// How far to either side of a node its room is felt, pt.
const SIDE = 40;

// What a tip asks of the garden it grows in.
export interface World {
  // The clearance at (x, y), pt: 0 on anything grown, outside the region
  // or off it.
  room(x: number, y: number): number;
  // Whether (x, y) lies in the region, stems' ground included.
  open(x: number, y: number): boolean;
  // Whether leaves, sprays and blooms may be put at (x, y): not where only
  // stems run.
  parts(x: number, y: number): boolean;
  // Claim a disc of radius r at (x, y), counted at k of its radius; a
  // stem's claim also bars other stems from crossing it.
  claim(x: number, y: number, r: number, k: number): void;
  claimStem(x: number, y: number, r: number): void;
  // Whether a stem has claimed (x, y): tips never cross a stem, but may
  // grow under leaves and sprays.
  stem(x: number, y: number): boolean;
  // The pull of unclaimed points toward which a tip at (x, y) heading `a`
  // is drawn, as a vector, and how many there are; those within `kill`
  // are taken.
  pull(x: number, y: number, a: number, kill: number): [number, number, number];
  // Where a tip at (x, y) with no points near heads for the nearest by the
  // open cells, if any.
  seek(x: number, y: number): Pt | undefined;
  // Something grown at stem arc `arc` of tip t: started once its ink gets
  // there.
  node(t: Tip, arc: number, make: Make): void;
  // A leaf from p heading `ang`, up to `len` long, fitted to the room there
  // and claimed (engine grow.leaf), as its painter; undefined if none fits.
  leaf(p: Pt, ang: number, len: number): ((pt: Painter) => void) | undefined;
  // The length a large leaf is asked for, pt, before it is fitted.
  leafLength(): number;
  // The hero, on a stalk from p heading `ang`, if it is due and has room
  // there; claimed once given.
  hero(p: Pt, ang: number): Make | undefined;
}

// What grows at a node or a tip's end.
export type Make =
  | { readonly kind: "leaf"; readonly x: number; readonly y: number; readonly paint: (pt: Painter) => void }
  | { readonly kind: "spray"; readonly spray: string; readonly s: Pt; readonly tangent: number; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: "bloom" | "hero"; readonly s: Pt; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: "stalk"; readonly s: Pt; readonly tangent: number; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: "tip"; readonly x: number; readonly y: number; readonly a: number; readonly order: number; readonly w: number; readonly len: number };

export class Tip {
  readonly id: number;
  readonly order: number;
  main: boolean;
  readonly rng: Rng;
  x: number;
  y: number;
  a: number;
  k = 0;
  // The stem so far and its arc length at each point.
  readonly pts: Pt[];
  readonly arc: number[] = [0];
  // Width at its start and the length it may grow to.
  readonly w0: number;
  readonly len: number;
  // Growth owed (pt), steps since it was last fed enough, the arc of its
  // next node, how much of its stem is claimed, and which side its last
  // node went to.
  credit = 0;
  starved = 0;
  nextNode: number;
  claimed = 0;
  side = 1;
  ended = false;
  // A slow wander along its length, radians per unit.
  private readonly wobble: (x: number) => number;
  // Where it last sought food, and the arc it seeks again at.
  private goal: Pt | undefined;
  private seekAt = 0;
  // For a strand twined with others: the x it winds toward at page y.
  twine: ((y: number) => number) | undefined;
  // Steps since a main stem last had food near or a way to some.
  private lost = 0;

  constructor(id: number, rng: Rng, x: number, y: number, a: number, order: number, w0: number, len: number, main: boolean) {
    this.id = id;
    this.rng = rng;
    this.x = x;
    this.y = y;
    this.a = a;
    this.order = order;
    this.w0 = w0;
    this.len = len;
    this.main = main;
    this.pts = [[x, y]];
    this.nextNode = this.internode() * 0.6;
    this.wobble = G.noise(rng.fork("wobble"), 64);
  }

  get s(): number {
    return this.arc[this.arc.length - 1];
  }

  // The stem's full width at arc s, pt.
  width(s: number): number {
    const lo = this.main ? 2.4 : this.order === 1 ? 0.9 : 0.6;
    const taper = this.main ? 2600 : this.len * 1.3;
    return Math.max(lo, this.w0 * (1 - s / taper));
  }

  // The engine's leaf spacing along its stems.
  private internode(): number {
    return this.order === 0 ? this.rng.range(26, 44) : this.rng.range(20, 32);
  }

  // How hungry the tip is, for its share of growth: the room ahead and the
  // points it is drawn to.
  hunger(w: World): number {
    const ahead = G.polar([this.x, this.y], this.a, SENSE_AT);
    const n = w.pull(this.x, this.y, this.a, 0)[2];
    return Math.min(1.5, w.room(ahead[0], ahead[1]) / 40) + Math.min(1, n * 0.08);
  }

  // Grow one step; false once ended.
  step(w: World): boolean {
    if (this.ended) return false;
    const p: Pt = [this.x, this.y];
    // Feel ahead and to either side.
    // A strand twines over and under the others, so only side shoots shy
    // from stems.
    const feel = (da: number) => {
      const q = G.polar(p, this.a + da, SENSE_AT);
      return !this.main && w.stem(q[0], q[1]) ? 0 : w.room(q[0], q[1]);
    };
    const l = feel(SENSE_SIDE), c = feel(0), r = feel(-SENSE_SIDE);
    let vx = Math.cos(this.a) * 1.2, vy = Math.sin(this.a) * 1.2;
    // Turned toward the roomier side, as much as it is roomier.
    const da = (SENSE_SIDE * (l - r)) / (l + r + 1);
    const lean = this.main ? 0.6 : 1.1;
    vx += Math.cos(this.a + da) * lean;
    vy += Math.sin(this.a + da) * lean;
    const [px, py, n] = w.pull(this.x, this.y, this.a, 18);
    vx += px * 0.8;
    vy += py * 0.8;
    // With nothing near to draw it, the main stem seeks the nearest food by
    // the open cells, every so often.
    let seeking = false;
    if (n > 0) this.lost = 0;
    if (n === 0 && this.main) {
      if (this.s >= this.seekAt) {
        this.goal = w.seek(this.x, this.y);
        this.seekAt = this.s + 20;
      }
      // Behind what spans the margin, where only stems run, it hangs on
      // down however far the food beyond lies.
      this.lost = this.goal === undefined && w.parts(this.x, this.y) ? this.lost + 1 : 0;
      // No food left within reach: the stem has done its work.
      if (this.lost > 30) return this.end(w);
      if (this.goal !== undefined) {
        const d = Math.max(1, G.dist(p, this.goal));
        vx += ((this.goal[0] - this.x) / d) * 1.4;
        vy += ((this.goal[1] - this.y) / d) * 1.4;
        seeking = true;
      }
    }
    // A twined strand winds toward its own line down the margin, crossing
    // the others' as it goes.
    let twining = false;
    if (this.main && !seeking && this.twine !== undefined) {
      const gy = this.y - 30, gx = this.twine(gy);
      if (w.open(gx, gy)) {
        const d = Math.hypot(gx - this.x, gy - this.y);
        vx += ((gx - this.x) / d) * 1.6;
        vy += ((gy - this.y) / d) * 1.6;
        twining = true;
      }
    }
    // The page's fall: a hanging plant runs down its margin.
    vy -= this.main ? (seeking || twining ? 0.1 : 0.45) : 0.08;
    const wander = this.wobble(this.s / 90) * 0.25;
    const want = Math.atan2(vy, vx) + wander;
    // Closing in on something ahead, it bends harder.
    const urgent = G.clamp(1 - c / 16, 0, 1);
    const kmax = (this.main ? 1 / 90 : 1 / 40) * (1 - urgent) + (1 / 14) * urgent;
    const k = G.clamp((2 * Math.sin(G.turn(want, this.a))) / LOOK, -kmax, kmax);
    const dk = (this.main ? DK / 2 : DK) * STEP * (1 + 6 * urgent);
    this.k += G.clamp(k - this.k, -dk, dk);
    let a = this.a + this.k * STEP;
    // Blocked ahead: try turning away, a little more each way, else end.
    let tries = 0;
    // A new tip leaves the stem it grows from, which it may cross.
    const clear = (b: number) => {
      const q = G.polar(p, b, STEP);
      // Only a main stem runs on where only stems may; a shoot ends there.
      return w.open(q[0], q[1]) && (this.main || w.parts(q[0], q[1])) && (this.s < ESCAPE || this.main || !w.stem(q[0], q[1]));
    };
    // A shoot that meets something ends; a main stem turns along it, unless
    // it is falling onto a floor (nothing open for a while straight below),
    // where turning would only coil it back on itself.
    const floor = () => {
      for (let d = 6; d <= 60; d += 6) if (w.open(this.x, this.y - d)) return false;
      return true;
    };
    const most = this.main && !(Math.sin(this.a) < -0.3 && !clear(a) && floor()) ? 16 : 0;
    while (!clear(a) && tries < most) {
      tries++;
      a = this.a + (tries % 2 === 1 ? 1 : -1) * 0.13 * Math.ceil(tries / 2);
      this.k = 0;
    }
    if (tries >= most && !clear(a)) return this.end(w);
    this.a = a;
    this.x += STEP * Math.cos(a);
    this.y += STEP * Math.sin(a);
    this.pts.push([this.x, this.y]);
    this.arc.push(this.s + STEP);
    // Claim what has fallen far enough behind, every other point.
    while (this.claimed < this.pts.length && this.arc[this.claimed] < this.s - LAG) {
      if (this.claimed % 2 === 0) {
        const q = this.pts[this.claimed];
        w.claimStem(q[0], q[1], this.width(this.arc[this.claimed]) / 2 + GAP);
      }
      this.claimed++;
    }
    if (this.s >= this.nextNode) {
      this.node(w);
      this.nextNode = this.s + this.internode();
    }
    if (this.s >= this.len) return this.end(w);
    return true;
  }

  // Put out a leaf at the node, on alternate sides as the engine's stems
  // do, at a large leaf's length and as large as fits; now and then a
  // shoot, or the hero; where no leaf fits, a spray.
  private node(w: World): void {
    const p: Pt = [this.x, this.y];
    if (!w.parts(p[0], p[1])) return;
    const rng = this.rng;
    const side = -this.side;
    this.side = side;
    const q = G.polar(p, this.a + (side * Math.PI) / 2, SIDE);
    const room = w.parts(q[0], q[1]) ? w.room(q[0], q[1]) : 0;
    const out = this.a + side * rng.range(0.6, 1.05);
    if (this.main) {
      const hero = w.hero(p, out);
      if (hero !== undefined) {
        w.node(this, this.s, hero);
        return;
      }
    }
    if (this.order < 2 && room > 30 && rng.chance(this.main ? 0.12 : 0.08)) {
      const len = this.order === 0 ? rng.range(220, 480) : rng.range(80, 180);
      w.node(this, this.s, { kind: "tip", x: p[0], y: p[1], a: out, order: this.order + 1, w: this.width(this.s) * 0.62, len });
      return;
    }
    // Large leaves come in a spread of sizes, most near the middle.
    const size = 0.35 + 0.95 * ((rng.next() + rng.next()) / 2);
    // Leaves crowd the main stem and thin out along the shoots.
    const paint = rng.chance(this.order === 0 ? 0.95 : 0.55) ? w.leaf(p, out, w.leafLength() * size * (this.order === 0 ? 1 : 0.7)) : undefined;
    if (paint !== undefined) {
      w.node(this, this.s, { kind: "leaf", x: p[0], y: p[1], paint });
      return;
    }
    if (room > 9) {
      const d = G.clamp(room * 0.9, 14, 40);
      const c = G.polar(p, this.a + side * rng.range(0.8, 1.2), d);
      if (!w.parts(c[0], c[1]) || w.room(c[0], c[1]) < 6) return;
      const r = G.clamp(w.room(c[0], c[1]) * 0.9, 8, 22);
      const spray = rng.weighted({ gyps: 5, cyme: 2, umbel: 1.5 }) ?? "gyps";
      w.claim(c[0], c[1], r, 0.9);
      w.node(this, this.s, { kind: "spray", spray, s: p, tangent: this.a, x: c[0], y: c[1], r });
    }
  }

  // End the tip: in a bloom where there is room, else a leaf, else bare.
  end(w?: World): boolean {
    if (this.ended) return false;
    this.ended = true;
    if (w === undefined) return false;
    const p: Pt = [this.x, this.y];
    const ahead = G.polar(p, this.a, 10);
    const room = w.parts(ahead[0], ahead[1]) ? w.room(ahead[0], ahead[1]) : 0;
    // A bloom, centred where it has room for its petals.
    const c = G.polar(p, this.a, Math.min(14, room * 0.5));
    const R = Math.min(22, w.parts(c[0], c[1]) ? w.room(c[0], c[1]) * 0.6 : 0);
    if (R >= 7) {
      w.claim(c[0], c[1], R, 0.9);
      w.node(this, this.s, { kind: "bloom", s: p, x: c[0], y: c[1], r: R });
    } else if (room >= 6) {
      const paint = w.leaf(p, this.a, G.clamp(room * 1.8, 14, 30));
      if (paint !== undefined) w.node(this, this.s, { kind: "leaf", x: p[0], y: p[1], paint });
    }
    return false;
  }
}
