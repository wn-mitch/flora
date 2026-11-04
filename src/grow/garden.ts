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
import { CORRIDOR, grow as EG, Rng, Space, type Painter } from "../engine/index.ts";
import type { RGB } from "../engine/color.ts";
import * as G from "../engine/geom.ts";
import type { Pt } from "../engine/geom.ts";
import * as P from "./pieces.ts";
import type { Piece } from "./pieces.ts";
import { STEP, Tip, type Make, type World } from "./tip.ts";
import { BAND, Food } from "./food.ts";

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
  // The main stem's width at the root, pt.
  readonly stemWidth?: number;
}

// Pt of growth shared among the tips each tick, and the most one takes.
const BUDGET = 2.2, MAX_SHARE = 1.6;
// Pt of stem each stem's pen inks per tick, and the stretch inked at once.
const INK = 1.6, CHUNK = 36, FIRST_CHUNK = 8;
// The most tips growing at once.
const MAX_TIPS = 36;
// Pt of stem grown before a tip may end in the hero.
const HERO_AFTER = 450;

interface Ink {
  // The point of the tip's stem inked up to, and the tick its pen is free.
  from: number;
  free: number;
  // What waits for the ink to reach it, by stem arc.
  waiting: { arc: number; make: Make }[];
}

export class Garden implements World {
  readonly o: GardenOptions;
  tick = 0;
  // The deepest the ink has reached, scene y.
  reach = 0;
  hero = false;
  private readonly space: Space;
  // The cells stems have claimed.
  private readonly stems: Uint8Array;
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
  // Stems sprouted again, the most there may be, and the food the last
  // one sought.
  private sprouts = 0;
  private readonly maxSprouts: number;
  private goal: Pt | undefined;
  // The lowest any stem has reached, page y.
  private deepest = Infinity;

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
    this.food = new Food(o.width, o.height, 3, (k) => this.rng.fork("band:" + k), (x, y) => this.space.free(x, y));
    this.maxSprouts = 4 + Math.ceil(o.height / 200);
    const wide = Math.max(...o.open.map((r) => r[2] - r[0]));
    this.heroR = G.clamp(wide * 0.22, 26, 56);
    this.startTip(o.root[0], o.root[1], o.heading, 0, o.stemWidth ?? 4.2, Infinity, true);
  }

  // Whether nothing more will grow or be laid down.
  get done(): boolean {
    return this.tips.length === 0 && this.queue.length === 0 && this.pieces.length === 0;
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
      if (tp.main) share = Math.max(share, 0.5);
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
      if (ended.some((tp) => tp.main) && this.tips.length > 0) {
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

  private startTip(x: number, y: number, a: number, order: number, w: number, len: number, main: boolean, id = this.nextId++): void {
    const tp = new Tip(id, this.rng.fork("tip:" + id), x, y, a, order, w, len, main);
    this.tips.push(tp);
    this.tips.sort((p, q) => p.id - q.id);
    this.inks.set(id, { from: 0, free: this.tick, waiting: [] });
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
      const id = this.nextId++;
      const rng = this.rng.fork("stem:" + id);
      this.add(P.pieceOf(this.ink, id, "stem", start, INK, pts[0], (pt) => P.stem(pt, rng, pts, tp.width(s0), tp.width(s1))));
      e.free = start + (s1 - tp.arc[i0]) / INK;
      e.from = i1;
      const ready = e.waiting.filter((wt) => wt.arc <= s1 + 1e-9);
      e.waiting = e.waiting.filter((wt) => wt.arc > s1 + 1e-9);
      for (const wt of ready) this.make(Math.ceil(start + Math.max(0, wt.arc - s0) / INK), wt.make);
    }
    if (last) {
      for (const wt of e.waiting) this.make(Math.ceil(e.free), wt.make);
      e.waiting = [];
    }
  }

  // Start `make` at tick `at`: paint it now, laid down from then.
  private make(at: number, m: Make): void {
    const id = this.nextId++;
    const rng = this.rng.fork(m.kind + ":" + id);
    if (m.kind === "tip") {
      if (this.tips.length + this.queue.length >= MAX_TIPS) return;
      this.queue.push({ at, id, make: m });
      this.queue.sort((p, q) => p.at - q.at || p.id - q.id);
      return;
    }
    let piece: Piece;
    if (m.kind === "leaf") piece = P.pieceOf(this.ink, id, "leaf", at, 1, [m.x, m.y], m.paint);
    else if (m.kind === "spray") piece = P.pieceOf(this.ink, id, "spray", at, 1, m.s, (pt) => P.spray(pt, rng, m.spray, m.s, m.tangent, m.x, m.y, m.r));
    else if (m.kind === "stalk") piece = P.pieceOf(this.ink, id, "bloom", at, 1, m.s, (pt) => P.stalked(pt, rng, m.s, m.tangent, m.x, m.y, m.r));
    else if (m.kind === "hero") piece = P.pieceOf(this.ink, id, "hero", at, 1, m.s, (pt) => P.hero(pt, rng, m.x, m.y, m.r));
    else piece = P.pieceOf(this.ink, id, "bloom", at, 1, m.s, (pt) => P.bloom(pt, rng, m.x, m.y, m.r));
    this.add(piece);
  }

  private add(p: Piece): void {
    // Kept by start, then id, so pieces are laid down in a fixed order.
    let i = this.pieces.length;
    while (i > 0 && (this.pieces[i - 1].start > p.start || (this.pieces[i - 1].start === p.start && this.pieces[i - 1].id > p.id))) i--;
    this.pieces.splice(i, 0, p);
  }

  // World, for the tips.
  room(x: number, y: number): number {
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
    const paint = EG.leaf(this.space, this.rng.fork("leaf:" + this.nextId++), p, ang, len, 0.35, () => 1);
    return paint;
  }
  node(tp: Tip, arc: number, m: Make): void {
    // The hero needs room for its petals, which reach past its radius.
    if (m.kind === "bloom" && !this.hero && this.grown >= HERO_AFTER && this.room(m.x, m.y) >= this.heroR * 1.25) {
      this.hero = true;
      this.claim(m.x, m.y, this.heroR, 0.85);
      m = { kind: "hero", s: m.s, x: m.x, y: m.y, r: this.heroR };
    }
    this.inks.get(tp.id)!.waiting.push({ arc, make: m });
  }

  // With no tip growing and food left, sprout a new stem from the stem
  // point nearest it by the open cells, heading for it. A sprout that came
  // to nothing takes the food it sought, so every sprout uses some up.
  private sproutAgain(): void {
    if (this.tips.length > 0 || this.queue.length > 0 || this.sprouts >= this.maxSprouts) return;
    this.food.seedTo(Infinity, this.tick);
    if (this.goal !== undefined) this.food.take(this.goal[0], this.goal[1], 50);
    const pass = (x: number, y: number) => this.open(x, y) && !this.stem(x, y);
    // On down first, as a hanging plant grows; then whatever is left.
    const stem = (x: number, y: number) => this.stem(x, y);
    const s = this.food.sprout(pass, stem, 400000, this.deepest + 60) ?? this.food.sprout(pass, stem, 400000);
    this.goal = s?.goal;
    if (s === undefined) {
      this.sprouts = this.maxSprouts;
      return;
    }
    this.sprouts++;
    this.startTip(s.at[0], s.at[1], s.a, 0, 2.4, Infinity, true);
  }

  // Gild each band once no tip is near it: its widest quiet spaces, from
  // the largest down, each kept clear of the last.
  private settle(): void {
    let low = Infinity;
    for (const tp of this.tips) low = Math.min(low, tp.y);
    for (let k = 0; k < this.food.bands.length; k++) {
      const b = this.food.bands[k];
      if (b === undefined || b.settled) continue;
      const y1 = this.o.height - k * BAND, y0 = y1 - BAND;
      if (this.tick < b.at + 60) continue;
      if (this.tips.some((tp) => tp.y > y0 - 60 && tp.y < y1 + 60)) continue;
      if (low !== Infinity && low > y0 - 120) continue;
      if (this.queue.some((q) => q.make.y > y0 - 60 && q.make.y < y1 + 60)) continue;
      b.settled = true;
      this.gild(k, y0, y1);
    }
    if (!this.hero && this.tips.length === 0 && this.queue.length === 0) this.lastHero();
  }

  private gild(k: number, y0: number, y1: number): void {
    const rng = this.rng.fork("gilt:" + k);
    const c = 6;
    const found: [number, number, number][] = [];
    for (let y = y0 + c / 2; y < y1; y += c) {
      for (let x = c / 2; x < this.o.width; x += c) {
        const r = this.room(x, y);
        if (r < 12 || !this.parts(x, y) || !this.nearStem(x, y, 70)) continue;
        if (r < this.room(x + c, y) || r < this.room(x - c, y) || r < this.room(x, y + c) || r < this.room(x, y - c)) continue;
        found.push([x, y, r]);
      }
    }
    found.sort((p, q) => q[2] - p[2] || q[1] - p[1] || p[0] - q[0]);
    const chosen: [number, number][] = [];
    const most = Math.max(1, Math.round((this.o.width * BAND) / 26000));
    for (const [x, y, r] of found) {
      if (chosen.length >= most) break;
      if (chosen.some((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 < 900) || this.room(x, y) < 9) continue;
      chosen.push([x, y]);
      const id = this.nextId++, at = this.tick + 30 + 10 * chosen.length;
      if (r >= 26 && rng.chance(0.3)) {
        this.claim(x, y, 12, 1);
        this.add(P.pieceOf(this.ink, id, "gilt", at, 1, [x, y], (pt) => P.compass(pt, x, y, 7)));
      } else {
        const size = Math.min(7.5, r * 0.45);
        const kind = size >= 4.5 ? (rng.weighted({ cross: 2, rosette: 2, dotted: 1 }) ?? "cross") : (rng.weighted({ plain: 5, lozenge: 2 }) ?? "plain");
        this.claim(x, y, size * 2.2, 1);
        this.add(P.pieceOf(this.ink, id, "gilt", at, 1, [x, y], (pt) => P.sparkle(pt, x, y, size, kind)));
      }
    }
  }

  // Whether a stem passes within r of (x, y): gilt sits among what has
  // grown, not in the open where nothing has.
  private nearStem(x: number, y: number, r: number): boolean {
    for (let d = 12; d <= r; d += 12) {
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        if (this.space.openAt(x + d * Math.cos(a), y + d * Math.sin(a)) && this.stem(x + d * Math.cos(a), y + d * Math.sin(a))) return true;
      }
    }
    return false;
  }

  // No tip ended in the hero: put it in the widest space left that a stem
  // passes near, on a stalk from that stem.
  private lastHero(): void {
    this.hero = true;
    const f = this.space.f!, c = this.space.c, nx = this.space.nx;
    const order: number[] = [];
    for (let i = 0; i < f.length; i++) if (f[i] >= 20) order.push(i);
    order.sort((p, q) => f[q] - f[p] || p - q);
    for (const i of order.slice(0, 400)) {
      const x = (i % nx + 0.5) * c, y = (Math.floor(i / nx) + 0.5) * c;
      if (!this.parts(x, y)) continue;
      const r = Math.min(this.heroR, f[i] * 0.75);
      const s = this.nearestStem(x, y, r + 60);
      if (s === undefined) continue;
      this.claim(x, y, r, 0.85);
      const id = this.nextId++, rng = this.rng.fork("hero:" + id);
      this.add(P.pieceOf(this.ink, id, "hero", this.tick + 20, 1, s, (pt) => P.stalkedHero(pt, rng, s, x, y, r)));
      return;
    }
  }

  // The stem point nearest (x, y) within r, by rings outward.
  private nearestStem(x: number, y: number, r: number): Pt | undefined {
    for (let d = 3; d <= r; d += 3) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * d) / 3));
      for (let k = 0; k < n; k++) {
        const a = (k * 2 * Math.PI) / n, q: Pt = [x + d * Math.cos(a), y + d * Math.sin(a)];
        if (this.stem(q[0], q[1]) && this.space.openAt(q[0], q[1])) return q;
      }
    }
    return undefined;
  }
}
