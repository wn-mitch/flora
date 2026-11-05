// How a garden (garden.ts) fills a band once no tip is near it, as the
// engine fills a page's holes: sprays and stalked blooms from the nearest
// stem into its widest quiet spaces, then gilt in what is still quiet; and
// where the hero goes when no tip ended in it.
import type { Rng, Space } from "../engine/index.ts";
import * as G from "../engine/geom.ts";
import type { Pt } from "../engine/geom.ts";
import { flatten } from "../flatten.ts";
import type { Item } from "../display.ts";
import * as P from "./pieces.ts";
import type { Piece } from "./pieces.ts";
import { BAND } from "./food.ts";

// What of the garden filling it reads and changes.
export interface Host {
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly space: Space;
  readonly rng: Rng;
  readonly ink: P.Ink;
  readonly heroR: number;
  room(x: number, y: number): number;
  parts(x: number, y: number): boolean;
  stem(x: number, y: number): boolean;
  // The tick the ink reaches (x, y), Infinity if it has not been laid.
  inkTick(x: number, y: number): number;
  claim(x: number, y: number, r: number, k: number): void;
  add(p: Piece): void;
  // A new component's id; and that the hero is placed.
  id(): number;
  placed(): void;
}

export class Fill {
  private readonly h: Host;

  constructor(h: Host) {
    this.h = h;
  }

  // The quiet spaces of band k (page rows y0..y1) near what has grown:
  // [x, y, room], the widest first.
  private holes(y0: number, y1: number, least: number): [number, number, number][] {
    const c = 6, found: [number, number, number][] = [];
    for (let y = y0 + c / 2; y < y1; y += c) {
      for (let x = c / 2; x < this.h.width; x += c) {
        const r = this.h.room(x, y);
        if (r < least || !this.h.parts(x, y) || !this.nearStem(x, y, 90)) continue;
        if (r < this.h.room(x + c, y) || r < this.h.room(x - c, y) || r < this.h.room(x, y + c) || r < this.h.room(x, y - c)) continue;
        found.push([x, y, r]);
      }
    }
    found.sort((p, q) => q[2] - p[2] || q[1] - p[1] || p[0] - q[0]);
    return found;
  }

  // Fill band k once no tip is near it, as the engine fills a page's holes:
  // each widest hole left gets a spray or a bloom on a stalk from the
  // stem nearest it, the largest first; then gilt in what is still quiet.
  gild(k: number, y0: number, y1: number): void {
    const rng = this.h.rng.fork("holes:" + k);
    let n = 0;
    const most = Math.round((this.h.width * BAND) / 4500);
    for (const [x, y] of this.holes(y0, y1, 7)) {
      if (n >= most) break;
      const r = this.h.room(x, y);
      if (r < 7) continue;
      const s = this.nearestStem(x, y, 90);
      if (s === undefined || !this.clearTo(s, [x, y])) continue;
      // Not before the stem it grows from is inked there.
      const ink = this.h.inkTick(s[0], s[1]);
      if (ink === Infinity) continue;
      const id = this.h.id(), at = Math.max(this.h.tick + 10 + 5 * n, Math.ceil(ink) + 2), pr = this.h.rng.fork("hole:" + id);
      n++;
      const bloom = r >= 16 && rng.chance(0.25);
      const kind = rng.weighted(r > 18 ? { gyps: 5, cyme: 2, umbel: 1.2 } : { gyps: 5, cyme: 2 }) ?? "gyps";
      // Shrunk until all it paints lies where it may.
      for (let k = bloom ? Math.min(26, r * 0.75) : Math.min(28, r * 0.8), tries = 0; tries < 3 && k >= 6; tries++, k *= 0.7) {
        const R = k;
        const piece = bloom
          ? P.pieceOf(this.h.ink, id, "bloom", at, 1, s, (pt) => P.stalked(pt, pr.clone(), s, G.angle(s, [x, y]), x, y, R))
          : P.pieceOf(this.h.ink, id, "spray", at, 1, s, (pt) => P.spray(pt, pr.clone(), kind, s, G.angle(s, [x, y]), x, y, R));
        if (!this.within(piece)) continue;
        this.h.claim(x, y, R, 0.9);
        this.h.add(piece);
        break;
      }
    }
    this.gilt(k, y0, y1);
  }

  private gilt(k: number, y0: number, y1: number): void {
    const rng = this.h.rng.fork("gilt:" + k);
    const found = this.holes(y0, y1, 12);
    const chosen: [number, number][] = [];
    const most = Math.max(1, Math.round((this.h.width * BAND) / 26000));
    for (const [x, y, r] of found) {
      if (chosen.length >= most) break;
      if (chosen.some((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 < 900) || this.h.room(x, y) < 9) continue;
      chosen.push([x, y]);
      const id = this.h.id(), at = this.h.tick + 30 + 10 * chosen.length;
      if (r >= 26 && rng.chance(0.3)) {
        this.h.claim(x, y, 12, 1);
        this.h.add(P.pieceOf(this.h.ink, id, "gilt", at, 1, [x, y], (pt) => P.compass(pt, x, y, 7)));
      } else {
        const size = Math.min(7.5, r * 0.45);
        const kind = size >= 4.5 ? (rng.weighted({ cross: 2, rosette: 2, dotted: 1 }) ?? "cross") : (rng.weighted({ plain: 5, lozenge: 2 }) ?? "plain");
        this.h.claim(x, y, size * 2.2, 1);
        this.h.add(P.pieceOf(this.h.ink, id, "gilt", at, 1, [x, y], (pt) => P.sparkle(pt, x, y, size, kind)));
      }
    }
  }

  // Whether a stem passes within r of (x, y): gilt sits among what has
  // grown, not in the open where nothing has.
  private nearStem(x: number, y: number, r: number): boolean {
    for (let d = 12; d <= r; d += 12) {
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        if (this.h.space.openAt(x + d * Math.cos(a), y + d * Math.sin(a)) && this.h.stem(x + d * Math.cos(a), y + d * Math.sin(a))) return true;
      }
    }
    return false;
  }

  // No tip ended in the hero: put it in the widest space left that a stem
  // passes near, on a stalk from that stem.
  lastHero(): void {
    this.h.placed();
    const f = this.h.space.f!, c = this.h.space.c, nx = this.h.space.nx;
    const order: number[] = [];
    for (let i = 0; i < f.length; i++) if (f[i] >= 20) order.push(i);
    order.sort((p, q) => f[q] - f[p] || p - q);
    for (const i of order.slice(0, 400)) {
      const x = (i % nx + 0.5) * c, y = (Math.floor(i / nx) + 0.5) * c;
      if (!this.h.parts(x, y)) continue;
      const r = Math.min(this.h.heroR, f[i] * 0.75);
      const s = this.nearestStem(x, y, r + 60);
      if (s === undefined) continue;
      this.h.claim(x, y, r, 0.85);
      const id = this.h.id(), rng = this.h.rng.fork("hero:" + id);
      this.h.add(P.pieceOf(this.h.ink, id, "hero", this.h.tick + 20, 1, s, (pt) => P.stalkedHero(pt, rng, s, x, y, r)));
      return;
    }
  }

  // Whether everything piece p paints lies where parts may go (a stem's
  // half width aside).
  private within(p: Piece): boolean {
    const H = this.h.height;
    const ok = (x: number, y: number) => this.h.parts(x, y) || this.h.parts(x + 2.5, y) || this.h.parts(x - 2.5, y) || this.h.parts(x, y + 2.5) || this.h.parts(x, y - 2.5);
    const walk = (items: readonly Item[]): boolean => {
      for (const it of items) {
        if (it.kind === "image") continue;
        for (const sub of flatten(it.path, { scale: 1, x0: 0, y0: 0 })) for (let i = 0; i < sub.length; i += 2) if (!ok(sub[i], H - sub[i + 1])) return false;
      }
      return true;
    };
    return walk(p.tl.at(Infinity).items);
  }

  // Whether the way from p to q lies where parts may go.
  private clearTo(p: Pt, q: Pt): boolean {
    const d = G.dist(p, q);
    for (let t = 0; t <= d; t += 3) if (!this.h.parts(p[0] + ((q[0] - p[0]) * t) / d, p[1] + ((q[1] - p[1]) * t) / d)) return false;
    return true;
  }

  // The stem point nearest (x, y) within r, by rings outward.
  private nearestStem(x: number, y: number, r: number): Pt | undefined {
    for (let d = 3; d <= r; d += 3) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * d) / 3));
      for (let k = 0; k < n; k++) {
        const a = (k * 2 * Math.PI) / n, q: Pt = [x + d * Math.cos(a), y + d * Math.sin(a)];
        // A point on the stem's line, where its ink runs.
        if (this.h.inkTick(q[0], q[1]) < Infinity && this.h.space.openAt(q[0], q[1])) return q;
      }
    }
    return undefined;
  }
}
