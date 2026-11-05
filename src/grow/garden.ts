// A garden grown online: a plant that grows into a region as it is
// watched, with nothing planned ahead. Its clock runs in ticks; each tick
// its tips (tip.ts) share a budget of growth by how hungry each is (the
// room ahead of it and the unclaimed points it is drawn to: Borchert and
// Honda's allocation, after Palubicki et al. 2009), the main stem
// favoured, and step that far. What a tip puts out starts once its ink
// gets there: each stretch of stem is inked behind the tip, and a leaf,
// spray, bloom or shoot at a node starts when that stretch's pen reaches
// it. Once a band of the region has no tip near it, its quiet open spaces
// are gilt. The first tip that ends in room enough, once enough has grown,
// ends in the hero bloom.
//
// Everything is a function of the seed, the region and the tick: each
// component draws from a stream of its own (Rng.fork) and everything is
// visited in a fixed order, so a garden grows alike stepped one tick at a
// time or many.
//
// Coordinates are page pt with y up from the region's foot, as the
// engine's; pieces (pieces.ts) are in the scene's, y down from the top.
import { CORRIDOR, grow as EG, Rng, Space, tune, type Painter } from "../engine/index.ts";
import type { RGB } from "../engine/color.ts";
import * as G from "../engine/geom.ts";
import type { Pt } from "../engine/geom.ts";
import * as P from "./pieces.ts";
import type { Piece } from "./pieces.ts";
import { STEP, Tip, type Make, type World } from "./tip.ts";
import { BAND, Food } from "./food.ts";
import { Fill } from "./fill.ts";
import { around, Weave, type Crossing } from "./weave.ts";

// [x0, y0, x1, y1], page pt.
export type Rect = readonly [number, number, number, number];

export interface GardenOptions {
  readonly width: number;
  readonly height: number;
  // Where it may grow, less what is closed; in `stems` only stems run.
  readonly open: readonly Rect[];
  readonly closed?: readonly Rect[];
  readonly stems?: readonly Rect[];
  // Where the main stem starts, and its heading (radians, y up).
  readonly root: Pt;
  readonly heading: number;
  readonly seed: number | string;
  readonly palette?: Readonly<Record<string, unknown>>;
  readonly paper?: RGB;
  // The main stem's width at the root, pt, and how many strands twine
  // down from the root together (1 for a single stem).
  readonly stemWidth?: number;
  readonly strands?: number;
  // Whether crossing strands take turns over and under (on by default),
  // and whether leaves and sprays lie some in front of the stems and some
  // behind (off: all in front, as the engine paints a page).
  readonly weave?: boolean;
  readonly depth?: boolean;
  // Whether a leaf keeps a band of clean paper outside its edge, and a
  // stem one either side where it passes in front of what is behind it,
  // as a strand passing over another does.
  readonly gaps?: boolean;
}

// Pt of growth shared among the tips each tick, and the most one takes;
// and how far a strand may trail the deepest stem, pt, before it hurries.
const BUDGET = 2.2, MAX_SHARE = 1.6, CATCH_UP = 60;
// Pt of stem a stem's pen inks per tick at most and at least, and the
// stretch inked at once.
const INK = 1.6, SLOW_INK = 0.3, CHUNK = 36, FIRST_CHUNK = 4;
// The most tips growing at once.
const MAX_TIPS = 36;
// Pt of stem grown before a tip may end in the hero.
const HERO_AFTER = 80;
// The paper either side of a strand passing over another, pt; and the
// share of leaves and of sprays put behind the stems, with depth.
const OVER_GAP = 1.3, FAR_LEAF = 0.35, FAR_SPRAY = 0.5;
// With gaps, the paper outside a leaf's edge, pt.
const LEAF_GAP = 1.1;
// How far what grows at a point may reach from it, pt: the longest leaf,
// with room to spare.
const REACH = 300;
// The room a stem feels where only stems run, pt: enough that it runs on
// at its ease.
const BEHIND = 40;

interface Ink {
  // The point of the tip's stem inked up to, the tick its pen is free,
  // the tick that stretch was taken up, and the pace it inks at, pt a tick.
  from: number;
  free: number;
  cut: number;
  pace: number;
  // What waits for the ink to reach it, by stem arc.
  waiting: { arc: number; make: Make }[];
}

export class Garden implements World {
  readonly o: GardenOptions;
  tick = 0;
  // The deepest the ink has reached, scene y.
  reach = 0;
  // Whether the hero is placed.
  private hero_ = false;
  get placedHero(): boolean {
    return this.hero_;
  }
  private readonly space: Space;
  // The cells stems have claimed.
  private readonly stems: Uint8Array;
  // The tick the ink reaches each cell of a stem (0: none yet).
  private readonly inkAt: Float64Array;
  // The pace the ink reaching each cell first runs at, pt per tick.
  private readonly inkPace: Float64Array;
  private readonly rng: Rng;
  private readonly ink: P.Ink;
  private nextId = 1;
  private tips: Tip[] = [];
  private inks = new Map<number, Ink>();
  // Tips to start at a tick, in order.
  private queue: { at: number; id: number; make: Make & { kind: "tip" } }[] = [];
  // Pieces painted but not yet laid down, by start; and those laid down
  // since takeFinished last ran, in the order they were.
  private pieces: Piece[] = [];
  private finished: Piece[] = [];
  private readonly food: Food;
  private grown = 0;
  private readonly heroR: number;
  // The region's widest open stretch, pt.
  private readonly wide: number;
  // Stems sprouted again, the most there may be, and the food the last
  // one sought.
  private sprouts = 0;
  private readonly maxSprouts: number;
  private goal: Pt | undefined;
  // The lowest any stem has reached, page y.
  private deepest = Infinity;
  private readonly spans = new Map<number, [number, number]>();
  private readonly fill: Fill;
  private readonly weave = new Weave();
  // Every tip started, in order, for the stems they have grown.
  private readonly grownTips: Tip[] = [];
  // The scene row above which nothing more is added, kept rising.
  private settled = 0;

  constructor(o: GardenOptions) {
    this.o = o;
    this.rng = new Rng(o.seed);
    this.ink = { width: o.width, height: o.height, palette: o.palette, paper: o.paper };
    const g = new Space(o.width, o.height, 3);
    for (const r of o.open) g.open(r[0], r[1], r[2], r[3]);
    for (const r of o.closed ?? []) g.close(r[0], r[1], r[2], r[3]);
    // Where only stems run is kept as text is: nothing else is put there.
    for (const r of o.stems ?? []) g.blockText(r[0], r[1], r[2], r[3]);
    g.field();
    this.space = g;
    this.stems = new Uint8Array(g.nx * g.ny);
    this.inkAt = new Float64Array(g.nx * g.ny);
    this.inkPace = new Float64Array(g.nx * g.ny);
    // No food hard by the region's edge, which a stem would run along.
    this.food = new Food(o.width, o.height, 3, (k) => this.rng.fork("band:" + k), (x, y) => this.space.free(x, y) && this.room(x, y) >= 12);
    this.maxSprouts = 4 + Math.ceil(o.height / 200);
    const wide = Math.max(...o.open.map((r) => r[2] - r[0]));
    this.wide = wide;
    this.heroR = G.clamp(wide * 0.26, 30, 70);
    const self = this;
    this.fill = new Fill({
      width: o.width, height: o.height, space: g, rng: this.rng, ink: this.ink, heroR: this.heroR,
      get tick() { return self.tick; },
      room: (x, y) => this.room(x, y),
      parts: (x, y) => this.parts(x, y),
      stem: (x, y) => this.stem(x, y),
      inkTick: (x, y) => this.inkTick(x, y),
      paceAt: (x, y) => this.paceAt(x, y),
      claim: (x, y, r, k) => this.claim(x, y, r, k),
      add: (p) => this.add(p),
      id: () => this.nextId++,
      placed: () => { this.hero_ = true; },
    });
    // The strands: the main stem's spine wanders slowly down the region,
    // and the others twine about it, each to and fro on a beat of its own,
    // crossing it and each other as they run down.
    const n = Math.max(1, o.strands ?? 3);
    const axis = G.noise(this.rng.fork("axis"), 64);
    const spine = (y: number) => {
      // Kept off the region's edges.
      const [s0, s1] = this.span(y), x0 = s0 + 30, x1 = Math.max(x0, s1 - 30);
      return [G.clamp((x0 + x1) / 2 + ((x1 - x0) / 3) * axis((o.height - y) / 900), x0, x1), x0, x1];
    };
    for (let i = 0; i < n; i++) {
      const r = this.rng.fork("strand:" + i);
      // Wide, slow bows, so the strands weave across each other rather than
      // coil tight about the spine.
      const phase = (2 * Math.PI * i) / n + r.jit(0.4), wave = r.range(520, 780), amp = r.range(50, 75);
      const a = o.heading + (i - (n - 1) / 2) * 0.35;
      const w = (o.stemWidth ?? 4.2) * (i === 0 ? 1 : r.range(0.45, 0.6));
      const tp = this.startTip(o.root[0], o.root[1], a, 0, w, Infinity, true);
      tp.twine = (y) => {
        const [mid, x0, x1] = spine(y);
        // No wider than the room each side of the spine, so a bow rounds
        // rather than runs flat along the clamp.
        const room = Math.min(amp, Math.max(0, Math.min(mid - x0, x1 - mid) + 20));
        return i === 0 ? mid : G.clamp(mid + room * Math.sin((2 * Math.PI * (o.height - y)) / wave + phase), x0, x1);
      };
    }
  }

  // The open stretch of page row y: its leftmost and rightmost open x.
  private span(y: number): [number, number] {
    const j = Math.floor(y / 3);
    const got = this.spans.get(j);
    if (got !== undefined) return got;
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < this.space.nx; i++) {
      const x = (i + 0.5) * 3;
      if (this.space.openAt(x, y) || this.space.textAt(x, y)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
    const s: [number, number] = x0 <= x1 ? [x0, x1] : [0, this.o.width];
    this.spans.set(j, s);
    return s;
  }

  // Whether nothing more will grow or be laid down.
  get done(): boolean {
    return this.tips.length === 0 && this.queue.length === 0 && this.pieces.length === 0;
  }

  // The scene row (y down) above which nothing more will be added: no tip
  // or what waits on one within reach of it, no band left to fill, no
  // piece still to be laid down. It only rises.
  get settledTo(): number {
    if (this.done) return Infinity;
    const H = this.o.height;
    // The hero, until placed, may go anywhere.
    let s = this.hero_ ? Infinity : 0;
    for (const tp of this.tips) s = Math.min(s, H - tp.y - REACH);
    for (const q of this.queue) s = Math.min(s, H - q.make.y - REACH);
    for (const p of this.pieces) s = Math.min(s, p.box[1]);
    for (let k = 0; k < this.food.bands.length; k++) {
      const b = this.food.bands[k];
      if (b !== undefined && !b.settled) {
        s = Math.min(s, k * BAND - 120);
        break;
      }
    }
    // With no tip growing the plant may sprout again from its stems.
    if (this.tips.length === 0 && this.sprouts < this.maxSprouts) s = Math.min(s, H - this.deepest - 2 * REACH);
    this.settled = Math.max(this.settled, s);
    return this.settled;
  }

  // The lines of the stems grown so far, page pt, each from where it
  // started, the main stems' first.
  get stemLines(): readonly (readonly Pt[])[] {
    return this.grownTips.map((tp) => tp.pts);
  }

  // Where strands have crossed so far, and which passed over.
  get crossings(): readonly Crossing[] {
    return this.weave.crossings;
  }

  // The pieces being laid down at this tick, by start.
  live(): Piece[] {
    return this.pieces.filter((p) => p.start <= this.tick);
  }

  // The pieces laid down since the last call, in the order they were.
  takeFinished(): Piece[] {
    const out = this.finished;
    this.finished = [];
    return out;
  }

  // Run n ticks.
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.tickOnce();
  }

  private tickOnce(): void {
    this.tick++;
    const t = this.tick;
    while (this.queue.length > 0 && this.queue[0].at <= t) {
      const q = this.queue.shift()!;
      this.startTip(q.make.x, q.make.y, q.make.a, q.make.order, q.make.w, q.make.len, false, q.id);
    }
    let low = Infinity;
    for (const tp of this.tips) low = Math.min(low, tp.y);
    if (low !== Infinity) this.food.seedTo(this.food.bandOf(low - BAND), t);
    // Share the budget by hunger, the main stem first among equals.
    const want = this.tips.map((tp) => tp.hunger(this) * (tp.main ? 3 : 0.7 ** tp.order));
    const sum = want.reduce((a, b) => a + b, 0);
    for (let i = 0; i < this.tips.length; i++) {
      const tp = this.tips[i];
      let share = sum > 0 ? Math.min(MAX_SHARE, (BUDGET * want[i]) / sum) : 0.4;
      // A side shoot too, so none lingers far behind the front.
      share = Math.max(share, tp.main ? 0.5 : 0.6);
      // A strand behind the deepest stem catches up, so the strands grow
      // down twined together rather than strung out down the page.
      if (tp.twine !== undefined) share = Math.min(MAX_SHARE, share + Math.max(0, tp.y - this.deepest - CATCH_UP) / 120);
      tp.starved = share < 0.15 ? tp.starved + 1 : 0;
      if (tp.starved > 150) tp.end(this);
      tp.credit += share;
      while (tp.credit >= STEP && !tp.ended) {
        tp.credit -= STEP;
        if (tp.step(this)) this.grown += STEP;
        this.deepest = Math.min(this.deepest, tp.y);
        this.inkTip(tp, false);
      }
    }
    for (const tp of this.tips) if (tp.ended) this.inkTip(tp, true);
    const ended = this.tips.filter((tp) => tp.ended);
    if (ended.length > 0) {
      this.tips = this.tips.filter((tp) => !tp.ended);
      if (ended.some((tp) => tp.main) && this.tips.length > 0 && !this.tips.some((tp) => tp.main)) {
        // The lowest tip carries the plant on down.
        let low = this.tips[0];
        for (const tp of this.tips) if (tp.y < low.y) low = tp;
        low.main = true;
      }
    }
    this.sproutAgain();
    this.settle();
    // Lay down what is due.
    const still: Piece[] = [];
    for (const p of this.pieces) {
      if (p.start <= t && p.kind === "stem") this.reach = Math.max(this.reach, p.box[3]);
      if (p.end <= t) this.finished.push(p);
      else still.push(p);
    }
    this.pieces = still;
  }

  private startTip(x: number, y: number, a: number, order: number, w: number, len: number, main: boolean, id = this.nextId++): Tip {
    const tp = new Tip(id, this.rng.fork("tip:" + id), x, y, a, order, w, len, main);
    this.tips.push(tp);
    this.grownTips.push(tp);
    this.tips.sort((p, q) => p.id - q.id);
    this.inks.set(id, { from: 0, free: this.tick, cut: this.tick, pace: INK, waiting: [] });
    return tp;
  }

  // Ink tip tp's stem up to its tip, a stretch at a time (all that is left
  // once it has ended), and start what waits on it.
  private inkTip(tp: Tip, last: boolean): void {
    const e = this.inks.get(tp.id)!;
    const i1 = tp.pts.length - 1, i0 = e.from;
    // The first stretch is short, so a stem shows at once.
    const chunk = i0 === 0 ? FIRST_CHUNK : CHUNK;
    if (i1 > i0 && (last || tp.arc[i1] - tp.arc[i0] >= chunk)) {
      const j0 = i0;
      const pts = tp.pts.slice(j0, i1 + 1), s0 = tp.arc[j0], s1 = tp.arc[i1];
      const start = Math.max(this.tick, e.free);
      // The pen keeps the pace the tip grew this stretch at, so it reaches
      // the stretch's end as the next is grown and runs on without a halt;
      // the first stretch it inks at once.
      const ink = j0 === 0 ? INK : G.clamp((s1 - s0) / Math.max(1, this.tick - e.cut), SLOW_INK, INK);
      e.cut = this.tick;
      e.pace = ink;
      const id = this.nextId++;
      const rng = this.rng.fork("stem:" + id);
      this.add(P.pieceOf(this.ink, id, "stem", start, ink, pts[0], (pt) => P.stem(pt, rng, pts, tp.width(s0), tp.width(s1))));
      // With gaps and depth, paper either side of it over what is behind.
      if (this.o.gaps === true && this.o.depth === true) {
        const w0 = tp.width(s0), w1 = tp.width(s1);
        // Its stem's id, negated, so turning gaps on changes nothing that grows.
        this.add(P.pieceOf(this.ink, -id, "stem", start, ink, pts[0], (pt) => P.lift(pt, pts, w0, w1, OVER_GAP), P.Z.lift));
      }
      // When the ink reaches each cell of the stretch.
      for (let i = i0; i <= i1; i++) this.inked(tp.pts[i][0], tp.pts[i][1], start + (tp.arc[i] - s0) / ink, ink);
      if (tp.order === 0 && this.o.weave !== false) this.over(tp, i0, i1, (i) => start + (tp.arc[i] - s0) / ink);
      e.free = start + (s1 - tp.arc[i0]) / ink;
      e.from = i1;
      const ready = e.waiting.filter((wt) => wt.arc <= s1 + 1e-9);
      e.waiting = e.waiting.filter((wt) => wt.arc > s1 + 1e-9);
      for (const wt of ready) this.make(Math.ceil(start + Math.max(0, wt.arc - s0) / ink), wt.make, ink);
    }
    if (last) {
      for (const wt of e.waiting) this.make(Math.ceil(e.free), wt.make, e.pace);
      e.waiting = [];
    }
  }

  // Where strand tp's segments i0..i1 - 1 cross the strands inked before
  // them, ink again over the gap whichever passes over.
  private over(tp: Tip, i0: number, i1: number, ink: (i: number) => number): void {
    for (const c of this.weave.ink(tp, i0, i1, ink)) {
      const top = c.over as Tip, under = c.under as Tip;
      const wo = top.width(c.s), wu = under.width(c.su);
      const half = (wu / 2 + OVER_GAP) / Math.max(0.35, Math.sin(c.angle)) + wo / 2 + 1;
      const pts = around(top, c.s, half);
      const id = this.nextId++, rng = this.rng.fork("over:" + id);
      this.add(P.pieceOf(this.ink, id, "stem", Math.ceil(c.t) + 1, INK, c.at, (pt) => P.over(pt, rng, pts, wo, OVER_GAP), P.Z.over));
    }
  }

  // Start `make` at tick `at`: paint it now, laid down from then; `pace`
  // is that of the ink of the stem it grows from there, pt a tick.
  private make(at: number, m: Make, pace: number): void {
    const id = this.nextId++;
    const rng = this.rng.fork(m.kind + ":" + id);
    if (m.kind === "tip") {
      if (this.tips.length + this.queue.length >= MAX_TIPS) return;
      this.queue.push({ at, id, make: m });
      this.queue.sort((p, q) => p.at - q.at || p.id - q.id);
      return;
    }
    let piece: Piece;
    // What runs out on a stalk from the stem inks it at the stem's pace
    // there, so it does not leap out ahead of the stem it grows from.
    if (m.kind === "leaf") piece = P.pieceOf(this.ink, id, "leaf", at, 1, [m.x, m.y], m.paint);
    else if (m.kind === "spray") piece = P.pieceOf(this.ink, id, "spray", at, pace, m.s, (pt) => P.spray(pt, rng, m.spray, m.s, m.tangent, m.x, m.y, m.r));
    else if (m.kind === "stalk") piece = P.pieceOf(this.ink, id, "bloom", at, pace, m.s, (pt) => P.stalked(pt, rng, m.s, m.tangent, m.x, m.y, m.r));
    else if (m.kind === "hero") piece = P.pieceOf(this.ink, id, "hero", at, pace, m.s, (pt) => P.stalkedHero(pt, rng, m.s, m.x, m.y, m.r));
    else piece = P.pieceOf(this.ink, id, "bloom", at, 1, m.s, (pt) => P.bloom(pt, rng, m.x, m.y, m.r));
    this.add(piece);
  }

  private add(p: Piece): void {
    // With depth, some leaves and sprays lie behind the stems.
    if (this.o.depth === true && (p.kind === "leaf" || p.kind === "spray") && this.rng.fork("z:" + p.id).chance(p.kind === "leaf" ? FAR_LEAF : FAR_SPRAY)) p = { ...p, z: P.Z.far };
    // Kept by start, then id, so pieces are laid down in a fixed order.
    let i = this.pieces.length;
    while (i > 0 && (this.pieces[i - 1].start > p.start || (this.pieces[i - 1].start === p.start && this.pieces[i - 1].id > p.id))) i--;
    this.pieces.splice(i, 0, p);
  }

  // World, for the tips.
  room(x: number, y: number): number {
    // Where only stems run (behind what spans the margin) nothing else is
    // put, so a stem steers through as through open room.
    // The region's edges still press on it there.
    if (this.space.textAt(x, y)) {
      const [x0, x1] = this.span(y);
      return Math.max(0, Math.min(BEHIND, x - x0, x1 - x));
    }
    return Math.max(0, this.space.room(x, y));
  }
  open(x: number, y: number): boolean {
    return this.space.openAt(x, y) || this.space.textAt(x, y);
  }
  parts(x: number, y: number): boolean {
    return this.space.openAt(x, y);
  }
  claim(x: number, y: number, r: number, k: number): void {
    this.space.disc(x, y, r, k);
  }
  claimStem(x: number, y: number, r: number): void {
    // A corridor, as the engine's stems are: leaves may lie over it.
    this.space.reserve(x, y, r, CORRIDOR);
    const c = 3, nx = this.space.nx, ny = this.space.ny;
    for (let j = Math.max(0, Math.floor((y - r) / c)); j <= Math.min(ny - 1, Math.floor((y + r) / c)); j++) {
      for (let i = Math.max(0, Math.floor((x - r) / c)); i <= Math.min(nx - 1, Math.floor((x + r) / c)); i++) {
        if (((i + 0.5) * c - x) ** 2 + ((j + 0.5) * c - y) ** 2 <= r * r) this.stems[j * nx + i] = 1;
      }
    }
  }
  // Record that the ink reaches (x, y) by tick t, running `pace` pt a tick.
  private inked(x: number, y: number, t: number, pace: number): void {
    const nx = this.space.nx, ny = this.space.ny;
    const i0 = Math.floor(x / 3), j0 = Math.floor(y / 3);
    if (i0 < 0 || j0 < 0 || i0 >= nx || j0 >= ny) return;
    const k = j0 * nx + i0;
    if (this.inkAt[k] === 0 || t < this.inkAt[k]) {
      this.inkAt[k] = t;
      this.inkPace[k] = pace;
    }
  }
  // The pace of the ink first reaching (x, y), pt per tick; where none has,
  // a pt a tick.
  private paceAt(x: number, y: number): number {
    const i = Math.floor(x / 3), j = Math.floor(y / 3);
    if (i < 0 || j < 0 || i >= this.space.nx || j >= this.space.ny) return 1;
    const p = this.inkPace[j * this.space.nx + i];
    return p > 0 ? p : 1;
  }
  // The tick the ink reaches (x, y), Infinity if it has not been laid.
  private inkTick(x: number, y: number): number {
    const i = Math.floor(x / 3), j = Math.floor(y / 3);
    if (i < 0 || j < 0 || i >= this.space.nx || j >= this.space.ny) return Infinity;
    const t = this.inkAt[j * this.space.nx + i];
    return t === 0 ? Infinity : t;
  }
  stem(x: number, y: number): boolean {
    const i = Math.floor(x / 3), j = Math.floor(y / 3);
    if (i < 0 || j < 0 || i >= this.space.nx || j >= this.space.ny) return true;
    return this.stems[j * this.space.nx + i] === 1;
  }
  pull(x: number, y: number, a: number, kill: number): [number, number, number] {
    return this.food.pull(x, y, a, kill);
  }
  seek(x: number, y: number): Pt | undefined {
    return this.food.seek(x, y, (px, py) => this.open(px, py) && !this.stem(px, py), 30, 6000);
  }
  leaf(p: Pt, ang: number, len: number): ((pt: Painter) => void) | undefined {
    if (!this.parts(p[0], p[1])) return undefined;
    // Leaves may grow across each other as far as the engine's do.
    return EG.leaf(this.space, this.rng.fork("leaf:" + this.nextId++), p, ang, len, tune.COMPOSE.leaf_overlap, () => 1, undefined, this.o.gaps === true ? LEAF_GAP : undefined);
  }
  leafLength(): number {
    return Math.min(130, this.wide * 0.85) * tune.COMPOSE.leaf_size;
  }
  hero(p: Pt, ang: number): Make | undefined {
    if (this.hero_ || this.grown < HERO_AFTER) return undefined;
    const R = this.heroR, c = G.polar(p, ang, R * 1.15);
    if (!this.parts(c[0], c[1]) || this.room(c[0], c[1]) < R * 1.05) return undefined;
    this.hero_ = true;
    this.claim(c[0], c[1], R, 0.85);
    return { kind: "hero", s: p, x: c[0], y: c[1], r: R };
  }
  node(tp: Tip, arc: number, m: Make): void {
    // The hero needs room for its petals, which reach past its radius.
    if (m.kind === "bloom" && !this.hero_ && this.grown >= HERO_AFTER && this.room(m.x, m.y) >= this.heroR * 1.25) {
      this.hero_ = true;
      this.claim(m.x, m.y, this.heroR, 0.85);
      m = { kind: "hero", s: m.s, x: m.x, y: m.y, r: this.heroR };
    }
    this.inks.get(tp.id)!.waiting.push({ arc, make: m });
  }

  // With no tip growing and food left below the plant, sprout a new stem
  // from the stem point nearest it by the open cells, heading for it. A sprout that came
  // to nothing takes the food it sought, so every sprout uses some up.
  private sproutAgain(): void {
    if (this.tips.length > 0 || this.queue.length > 0 || this.sprouts >= this.maxSprouts) return;
    this.food.seedTo(Infinity, this.tick);
    if (this.goal !== undefined) this.food.take(this.goal[0], this.goal[1], 50);
    const pass = (x: number, y: number) => this.open(x, y) && !this.stem(x, y);
    // Only on down, as a hanging plant grows: what is left above is filled
    // with sprays as its band settles (gild).
    // Not from a stem where only stems run, where nothing it puts out shows.
    const s = this.food.sprout(pass, (x, y) => this.stem(x, y) && this.parts(x, y), 400000, this.deepest - 20);
    this.goal = s?.goal;
    if (s === undefined) {
      this.sprouts = this.maxSprouts;
      return;
    }
    this.sprouts++;
    this.startTip(s.at[0], s.at[1], s.a, 0, 2.4, Infinity, true);
  }

  // Gild each band once no tip is in it or above it: its widest quiet
  // spaces, from the largest down, each kept clear of the last.
  private settle(): void {
    let low = Infinity;
    for (const tp of this.tips) low = Math.min(low, tp.y);
    for (let k = 0; k < this.food.bands.length; k++) {
      const b = this.food.bands[k];
      if (b === undefined || b.settled) continue;
      const y1 = this.o.height - k * BAND, y0 = y1 - BAND;
      if (this.tick < b.at + 60) continue;
      // Not while a tip is in it, or above it on its way down.
      if (this.tips.some((tp) => tp.y > y0 - 60)) continue;
      if (low !== Infinity && low > y0 - 120) continue;
      if (this.queue.some((q) => q.make.y > y0 - 60)) continue;
      b.settled = true;
      this.fill.gild(k, y0, y1);
    }
    if (!this.hero_ && this.tips.length === 0 && this.queue.length === 0) this.fill.lastHero();
  }
}
