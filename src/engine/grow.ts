// Placement on the clearance field (space.ts), in the order a plant grows:
// leaves at the stems' nodes, then blooms and sprays on branches grown out
// to the largest open holes, then small details close to the stems. Every
// placed element is recorded as proxy discs counted at k < 1 of their
// radius, so neighbours may tuck a little under each other but never pile
// up. The hole loop follows Wong, Zongker and Salesin, "Computer-Generated
// Floral Ornament" (SIGGRAPH 1998): take the largest free disc within reach
// of a stem, choose a motif that fits it, grow a branch to it.
import { fmt, mod } from "#platform";
import { sample } from "./dist.ts";
import * as Fl from "./flower.ts";
import * as Fill from "./fill.ts";
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import * as L from "./leaf.ts";
import type { Attachment, Leaflet, LeafOptions } from "./leaf.ts";
import * as M from "./mix.ts";
import type { ComposeCfg, Mix, Motif } from "./mix.ts";
import type { Painter } from "./paint.ts";
import * as P from "./plant.ts";
import type { Stem } from "./plant.ts";
import type { Rng } from "./rng.ts";
import * as S from "./sprig.ts";
import type { Space } from "./space.ts";
import { SIZES } from "./tune.ts";

const PI = Math.PI;

const REACH = 70;   // pt: a hole must lie within this distance of a stem
const DISC_K = 0.85; // blooms and sprays count at this share of their radius

// An element painted later, and where it stands (the growth clock opens it
// when the front reaches that point).
export interface Placed {
  readonly paint: (this: void, pt: Painter) => void;
  readonly at: Pt;
}

// A stem placement grows from: the plant's own stems (plant.ts), or a
// forkless strand such as a runner, an excursion or a bloom's stalk.
export interface StemLike {
  readonly pts: Pt[];
  readonly width?: (this: void, t: number) => number;
  readonly tip?: [Pt, number];
  readonly forks?: unknown;
}

const isStem = (s: StemLike): s is Stem => s.forks !== undefined;

// What a page's growth reads and fills.
export interface GrowContext {
  readonly cfg: ComposeCfg;
  readonly mix?: Mix;
  readonly mw: number;                                    // margin width
  readonly dens: (this: void, x: number, y: number) => number;
  readonly ylo: number;                                   // the margin's foot
  readonly span: number;                                  // from there to the hero
  readonly strands: readonly StemLike[];                  // stems that carry leaves and curls
  readonly stems: readonly StemLike[];                    // every stem holes are reached from
  readonly stemBatch: S.Batch;                            // bloom stalks
  readonly sprays: S.Batch;
  readonly blooms: Placed[];
  readonly back: Placed[];                                // behind the stems (ghost blooms)
  readonly leaves: Placed[];
  readonly leaflets: Leaflet[];
  readonly counts: Record<string, number>;                // motifs placed, by kind
  visitors?: Placed[];                                    // bees, butterflies, birds, snails (visitor.ts)
}

// A repeatable jitter in [0.85, 1.15) for cell k on pass `iter`, so the
// largest hole is not always the same shape of choice.
function jitter(k: number, iter: number): number {
  const v = Math.sin(k * 12.9898 + iter * 78.233) * 43758.5453;
  return 0.85 + 0.3 * (v - Math.floor(v));
}

// Do all points (every other one) lie in open space, clear of text?
export function openPath(g: Space, pts: readonly Pt[]): boolean {
  for (let i = 0; i < pts.length; i += 2) if (!g.openAt(pts[i][0], pts[i][1])) return false;
  return true;
}

type Disc = [number, number, number];

// Proxy discs [x, y, r] for leaf `o` based at p heading ang: five along its
// midrib, each as wide as the blade there.
export function leafDiscs(o: LeafOptions, p: Pt, ang: number): Disc[] {
  const spine = G.curve(p, ang, o.len, o.bend, o.hook, 20);
  return [0.2, 0.36, 0.52, 0.68, 0.84].map((t): Disc => {
    const q = spine[Math.floor(t * (spine.length - 1) + 0.5)];
    return [q[0], q[1], 1.1 * o.width * L.profile(o, t)];
  });
}

// Do discs fit the field, each allowed to overlap what is there by 1 - k?
function discsFit(g: Space, discs: readonly Disc[], k: number): boolean {
  for (const d of discs) if (g.room(d[0], d[1]) < k * d[2]) return false;
  return true;
}

// The strand a leaf grows from: its points, the fraction along it and its
// width function.
export interface Joint {
  readonly pts: readonly Pt[];
  readonly t: number;
  readonly width?: (this: void, t: number) => number;
}

// Where a leaf heading `ang` from `p` joins its stem (see leaf): the
// attachment for leaf.ts attach, drawn from its own fork of `r`, and the
// point its blade starts from. A leaf joined at the stem's silhouette
// stands off its edge on a short stalk; one in front of or behind it
// starts at its centre. Without a stem, no attachment and the blade starts
// at p.
export function joint(r: Rng, p: Pt, ang: number, len: number, stem?: Joint): { at?: Attachment; base: Pt } {
  if (stem === undefined) return { base: p };
  const f = r.fork("attach").range(-1, 1);
  const w = stem.width === undefined ? 1.5 : stem.width(stem.t);
  const ta = G.at(stem.pts, stem.t)[1];
  const side = Math.sin(ang - ta) >= 0 ? 1 : -1;
  const seg = stem.pts.filter((q) => G.dist(q, p) < len * 1.1);
  const base = Math.abs(f) < L.FRONT ? G.polar(p, ta + (side * PI) / 2, w / 2 + 3) : p;
  return { at: { f, p, seg, w }, base };
}

// Plan a large leaf of length up to `len` at `p`, heading `ang`, drawn with
// stream `r`. Its whole blade must fit the field, overlapping what is
// already placed by at most `overlap` of its width, and clear the text;
// otherwise it shrinks, up to three times. Returns its painter, or
// undefined. With `stem` the leaf blends into the stem at its joint.
export function leaf(g: Space, r: Rng, p: Pt, ang: number, len: number, overlap: number, factor: (kind: string) => number, stem?: Joint): ((this: void, pt: Painter) => void) | undefined {
  const k = 1 - overlap;
  const o = L.options(r, len, ang, factor);
  const { at, base } = joint(r, p, ang, len, stem);
  for (let tries = 0; tries < 3; tries++) {
    const discs = leafDiscs(o, p, ang);
    if (discsFit(g, discs, k) && openPath(g, G.transform(L.outline(r.clone(), o)[0], p[0], p[1], ang - PI / 2))) {
      for (const d of discs) g.disc(d[0], d[1], d[2], k);
      // Some lance leaves come in pairs, as the reference's stem leaves do:
      // a smaller one from the same node, turned aside. Its choices come
      // from a fork, so the main leaf's stream is left untouched.
      let mate: [number, LeafOptions, Rng] | undefined;
      const mr = r.fork("mate");
      if (o.margin === "entire" && o.len < 69 && mr.chance(0.35)) {
        const ma = ang + (mr.chance(0.5) ? 1 : -1) * mr.range(0.45, 0.7);
        const mo = L.options(mr, o.len * 0.65, ma, factor);
        const md = leafDiscs(mo, p, ma);
        if (discsFit(g, md, k) && openPath(g, G.transform(L.outline(mr.clone(), mo)[0], p[0], p[1], ma - PI / 2))) {
          for (const d of md) g.disc(d[0], d[1], d[2], k);
          mate = [ma, mo, mr];
        }
      }
      return (pt) => {
        o.attach = at;
        if (mate !== undefined) {
          mate[1].attach = at;
          L.leaf(pt, mate[2], base[0], base[1], mate[0], mate[1]);
        }
        L.leaf(pt, r, base[0], base[1], ang, o);
      };
    }
    o.len = o.len * 0.78;
    o.width = o.width * 0.78;
    if (o.len < 16) return undefined;
  }
  return undefined;
}

// A stemlet at p heading ang, about `len` long: a short stalk ending in two
// or three leaflets. Adds its stalk to the sprays and its leaflets to the
// context's.
function stemlet(g: Space, rng: Rng, ctx: GrowContext, p: Pt, ang: number, len: number, side: number): boolean {
  const stalk = len * rng.range(0.35, 0.5);
  const curve = G.curve(p, ang, stalk, side * rng.range(0.2, 0.5), 0, 6);
  if (!openPath(g, curve)) return false;
  const tip = curve[curve.length - 1];
  const ta = G.angle(curve[curve.length - 2], tip);
  const size = Math.min((len - stalk) * 0.85, 11);
  ctx.sprays.line(curve, 1);
  const spread = rng.range(0.45, 0.7);
  const fan = rng.chance(0.5) ? [-spread, spread] : [-spread, 0, spread];
  for (const da of fan) ctx.leaflets.push([tip[0], tip[1], ta + da, size * (da === 0 ? 1 : 0.8)]);
  g.disc(tip[0], tip[1], size * 0.6, DISC_K);
  return true;
}

const factorOf = (ctx: GrowContext) => (kind: string) => M.weight(ctx.mix, kind);

// Leaves at the nodes of each strand, alternating sides. Nodes sit
// leaf_spacing apart, spread further and holding smaller leaves where the
// border is quiet (ctx.dens). Where no leaf fits, a stemlet or a single
// leaflet takes the node if there is room.
export function nodeLeaves(g: Space, rng: Rng, strands: readonly StemLike[], ctx: GrowContext): void {
  const cfg = ctx.cfg;
  const sp = cfg.leaf_spacing;
  const factor = factorOf(ctx);
  for (let k = 0; k < strands.length; k++) {
    const st = strands[k];
    const pts = st.pts;
    const total = G.length(pts);
    let side = rng.chance(0.5) ? 1 : -1;
    let d = rng.range(sp[0], sp[1]) * 0.5;
    let n = 0;
    while (d < total - 8 && ctx.leaves.length < cfg.leaves) {
      n++;
      const [p, a] = G.at(pts, d / total);
      const dn = ctx.dens(p[0], p[1]);
      side = -side;
      const ang = a + side * rng.range(0.6, 1.05);
      const len = Math.min(130, ctx.mw * 0.85) * cfg.leaf_size * (0.45 + 0.55 * dn) * sample(rng, SIZES.leaf);
      const paint = len >= 24 ? leaf(g, rng.fork("leaf" + fmt(k + 1, 0) + "." + fmt(n, 0)), p, ang, len, cfg.leaf_overlap, factor, { pts, t: d / total, width: st.width }) : undefined;
      if (paint !== undefined) {
        ctx.leaves.push({ paint, at: p });
      } else {
        const q = G.polar(p, ang, 7);
        const room = g.room(q[0], q[1]);
        if (room >= 7 && rng.chance(0.45)) {
          stemlet(g, rng, ctx, p, ang, Math.min(room * 2.2, 26), side);
        } else if (room >= 4) {
          const size = Math.min(room * 1.6, cfg.leaflet_size * sample(rng, SIZES.leaflet));
          ctx.leaflets.push([p[0], p[1], ang, size]);
          const c = G.polar(p, ang, size * 0.5);
          g.disc(c[0], c[1], size * 0.3, DISC_K);
        }
      }
      d += rng.range(sp[0], sp[1]) * (1.7 - 0.7 * dn);
    }
  }
}

// Every shoot ends in something: a leaf where there is room, otherwise a
// forget-me-not cyme, otherwise a few buds.
export function tips(g: Space, rng: Rng, strands: readonly StemLike[], ctx: GrowContext): void {
  const cfg = ctx.cfg;
  const factor = factorOf(ctx);
  for (let k = 0; k < strands.length; k++) {
    const st = strands[k];
    if (st.tip === undefined) continue;
    const [p, a] = st.tip;
    const r = rng.fork("tip" + fmt(k + 1, 0));
    const len = Math.min(110, ctx.mw * 0.7) * cfg.leaf_size * sample(r, SIZES.leaf);
    const paint = len >= 20 && cfg.leaves > 0 ? leaf(g, r, p, a, len, cfg.leaf_overlap, factor, { pts: st.pts, t: 1, width: st.width }) : undefined;
    if (paint !== undefined) {
      ctx.leaves.push({ paint, at: p });
    } else {
      let tmp = new S.Batch();
      S.cyme(tmp, r, p, a, r.range(14, 22), r.chance(0.5) ? 1 : -1);
      if (!Fill.fits(g, tmp)) {
        tmp = new S.Batch();
        tmp.bud(p[0], p[1], a, 4);
      }
      if (Fill.fits(g, tmp)) {
        ctx.sprays.merge(tmp);
        g.disc(p[0], p[1], 8, DISC_K);
      }
    }
  }
}

// A stem point within reach of the holes: where, the stem's tangent, the
// stem and the fraction along it.
interface ReachPoint {
  readonly p: Pt;
  readonly a: number;
  readonly stem: StemLike;
  readonly t: number;
}

// Stem points within reach of the holes, and per field cell the distance
// to the nearest of them. `keys` lists the cells in reach in the order they
// were first reached, so scans over them are deterministic.
// A max-heap of cells by a key (a clearance), as two parallel arrays.
class CellHeap {
  private readonly key: number[] = [];
  private readonly cell: number[] = [];

  get size(): number {
    return this.key.length;
  }

  topKey(): number {
    return this.key[0];
  }

  push(v: number, k: number): void {
    const key = this.key, cell = this.cell;
    let i = key.length;
    key.push(v);
    cell.push(k);
    while (i > 0) {
      const up = Math.floor((i - 1) / 2);
      if (key[up] >= v) break;
      key[i] = key[up];
      cell[i] = cell[up];
      i = up;
    }
    key[i] = v;
    cell[i] = k;
  }

  // Remove the top cell and return it.
  pop(): number {
    const key = this.key, cell = this.cell;
    const top = cell[0];
    const v = key[key.length - 1], k = cell[cell.length - 1];
    key.pop();
    cell.pop();
    const n = key.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      const a = 2 * i + 1, b = a + 1;
      let m = i, mv = v;
      if (a < n && key[a] > mv) {
        m = a;
        mv = key[a];
      }
      if (b < n && key[b] > mv) m = b;
      if (m === i) break;
      key[i] = key[m];
      cell[i] = cell[m];
      i = m;
    }
    key[i] = v;
    cell[i] = k;
    return top;
  }
}

class ReachMap {
  readonly pts: ReachPoint[] = [];
  readonly sd: number[] = [];
  readonly keys: number[] = [];
  private readonly g: Space;

  constructor(g: Space) {
    this.g = g;
    for (let k = 0; k < g.nx * g.ny; k++) this.sd.push(Infinity);
  }

  add(stem: StemLike, step = 3): void {
    const pts = stem.pts;
    const { c, nx, ny } = this.g;
    const sd = this.sd, keys = this.keys;
    for (let i = 1; i < pts.length - 1; i += step) {
      const [px, py] = pts[i];
      this.pts.push({ p: pts[i], a: G.angle(pts[i - 1], pts[i + 1]), stem, t: i / (pts.length - 1) });
      const i0 = Math.max(0, Math.floor((px - REACH) / c)), i1 = Math.min(nx - 1, Math.floor((px + REACH) / c));
      const j0 = Math.max(0, Math.floor((py - REACH) / c)), j1 = Math.min(ny - 1, Math.floor((py + REACH) / c));
      for (let j = j0; j <= j1; j++) {
        const dy = (j + 0.5) * c - py;
        const row = j * nx;
        for (let ii = i0; ii <= i1; ii++) {
          const dx = (ii + 0.5) * c - px;
          const k = row + ii;
          const d = Math.sqrt(dx * dx + dy * dy);
          const old = sd[k];
          if (old === Infinity) {
            keys.push(k);
            sd[k] = d;
          } else if (d < old) {
            sd[k] = d;
          }
        }
      }
    }
  }

  nearest(x: number, y: number): [ReachPoint, number] {
    let best = this.pts[0], bd = Infinity;
    for (const q of this.pts) {
      const d = (q.p[0] - x) ** 2 + (q.p[1] - y) ** 2;
      if (d < bd) {
        best = q;
        bd = d;
      }
    }
    return [best, Math.sqrt(bd)];
  }
}

// The motifs a hole may take: weight, cap (undefined: limited only by the
// spray cap), and the radius range it comes in. Feature sizes scale with
// the margin width and COMPOSE.features. Each motif's weight and cap
// follow the page's mix.
function motifs(mw: number, cfg: ComposeCfg, rng: Rng, mix?: Mix): Motif[] {
  const kr = rng.range(cfg.features[0], cfg.features[1]);
  const all: Motif[] = [
    { kind: "bloom", w: 3, cap: cfg.small_blooms, rmin: 9, rmax: mw * 0.13 * kr },
    { kind: "soft", w: 1.5, cap: M.motifCap(2, cfg), rmin: 10, rmax: mw * 0.12 * kr },
    { kind: "lily", w: 1.2, cap: M.motifCap(1, cfg), rmin: 16, rmax: mw * 0.21 * kr },
    { kind: "ghost", w: 1, cap: 1, rmin: 16, rmax: mw * 0.22 * kr, below: 0.4 },
    { kind: "umbel", w: 1.6, cap: M.motifCap(3, cfg), rmin: 12, rmax: mw * 0.19 * kr },
    { kind: "cyme", w: 3, rmin: 7, rmax: 22, spray: true },
    { kind: "gyps", w: 4, rmin: 5, rmax: 30, spray: true },
  ];
  const out: Motif[] = [];
  for (const m of all) {
    const mm = M.motif(m, mix);
    if (mm !== undefined) out.push(mm);
  }
  return out;
}

// A bloom on a stalk grown from stem point s (distance sd) to centre c.
// Undefined if it would cross the text.
function bloomStalk(g: Space, s: ReachPoint, sd: number, c: Pt, r: number): Pt[] | undefined {
  const chord = G.angle(s.p, c);
  const dir0 = G.depart(s.p, s.a, c, 0.35);
  const base = G.polar(s.p, chord, Math.max(sd - r * 0.45, 3));
  const stalk = G.link(s.p, dir0, base, chord + G.turn(chord, dir0) * 0.6);
  return openPath(g, stalk) ? stalk : undefined;
}

// Fill the largest holes within reach of a stem, biggest first. A hole
// counts only while its clearance exceeds hole_min, raised where the
// border is quiet, so the quiet stretches stop filling first. Returns the
// motifs placed, by kind (ctx.counts).
export function holes(g: Space, rng: Rng, ctx: GrowContext): Record<string, number> {
  const cfg = ctx.cfg;
  const reach = new ReachMap(g);
  for (const st of ctx.stems) reach.add(st);
  const kinds = motifs(ctx.mw, cfg, rng.fork("motifs"), ctx.mix);
  const counts = ctx.counts;
  let sprays = 0;
  const f = g.f;
  if (f === undefined) throw new Error("grow: holes needs the clearance field (Space.field)");
  const nx = g.nx, c = g.c;
  const rejected: boolean[] = [], floors: number[] = [];
  for (let k = 0; k < nx * g.ny; k++) {
    rejected.push(false);
    floors.push(-1);
  }
  // The density field is fixed for the page, so each cell's floor is
  // worked out once, the first time the scan below asks for it.
  const floorAt = (k: number, x: number, y: number) => {
    let v = floors[k];
    if (v < 0) {
      v = cfg.hole_min * (1 + 1.4 * (1 - ctx.dens(x, y)));
      floors[k] = v;
    }
    return v;
  };
  // Each round places at the reachable cell of greatest jittered
  // clearance f * jitter (jitter under 1.15), the earliest reached on a
  // tie. Clearance and reach only fall, so the cells are kept in a heap by
  // the clearance they last had, an upper bound on what they have now: a
  // round looks only at those whose bound could still win, refreshing
  // stale ones, and picks just what scanning every cell would.
  const heap = new CellHeap();
  const pos: number[] = [];
  let known = 0;
  const looked: number[] = [];
  for (let iter = 1; iter <= 400; iter++) {
    let best = -1, bi = -1, bpos = Infinity;
    const sdm = reach.sd, keys = reach.keys;
    for (; known < keys.length; known++) {
      pos[keys[known]] = known;
      heap.push(f[keys[known]], keys[known]);
    }
    looked.length = 0;
    while (heap.size > 0 && heap.topKey() * 1.15 > best) {
      const bound = heap.topKey(), k = heap.pop();
      if (rejected[k]) continue;
      const fk = f[k];
      if (fk < bound) {
        heap.push(fk, k);
        continue;
      }
      looked.push(k);
      if (sdm[k] <= REACH) {
        const v = fk * jitter(k, iter);
        if (v > best || (v === best && pos[k] < bpos)) {
          const x = (mod(k, nx) + 0.5) * c, y = (Math.floor(k / nx) + 0.5) * c;
          if (fk >= floorAt(k, x, y)) {
            best = v;
            bi = k;
            bpos = pos[k];
          }
        }
      }
    }
    for (const k of looked) heap.push(f[k], k);
    if (bi < 0) break;
    const x = (mod(bi, nx) + 0.5) * c, y = (Math.floor(bi / nx) + 0.5) * c;
    const room = f[bi];
    const fy = (y - ctx.ylo) / ctx.span;
    const elig: [Motif, number][] = [];
    let wsum = 0;
    for (const m of kinds) {
      const n = counts[m.kind] ?? 0;
      const ok = m.rmin <= room * 1.05 && (m.cap === undefined || n < m.cap) && (m.below === undefined || fy < m.below) && (m.spray !== true || sprays < cfg.sprays);
      if (ok) {
        const wt = m.w / (1 + n / (m.cap ?? 8));
        elig.push([m, wt]);
        wsum += wt;
      }
    }
    let placed = false;
    if (elig.length > 0) {
      let chosen = elig[elig.length - 1][0], acc = rng.next() * wsum;
      for (const e of elig) {
        acc -= e[1];
        if (acc <= 0) {
          chosen = e[0];
          break;
        }
      }
      const r = Math.min(chosen.rmax, room * 0.95);
      const [s, sd] = reach.nearest(x, y);
      const fr = rng.fork("hole" + fmt(iter, 0));
      if (chosen.spray === true || chosen.kind === "umbel") {
        // Sprays reach past their nominal radius, so each is grown in a
        // scratch batch and kept only if it clears the text; then smaller.
        for (const [scale, lean] of [[1, fr.jit(0.3)], [0.7, 0]]) {
          const tmp = new S.Batch();
          const stalk = Fill.grow(tmp, fr, chosen.kind, s.p, s.a, sd, x, y, r, scale, lean);
          if (Fill.fits(g, tmp)) {
            ctx.sprays.merge(tmp);
            reach.add({ pts: stalk }, 2);
            g.disc(x, y, r * scale, DISC_K);
            placed = true;
            break;
          }
        }
      } else {
        const cpt: Pt = [x, y];
        const stalk = bloomStalk(g, s, sd, cpt, r);
        if (stalk !== undefined) {
          if (isStem(s.stem)) P.fork(s.stem, s.t, 0.7);
          ctx.stemBatch.stem(stalk, 0.7, 0.4);
          reach.add({ pts: stalk }, 2);
          g.disc(x, y, r, DISC_K);
          placed = true;
          if (chosen.kind === "lily") {
            const facing = G.angle(stalk[stalk.length - 2], stalk[stalk.length - 1]);
            ctx.blooms.push({ paint: (pt) => { Fl.tilted(pt, fr, x, y, r, facing, 1.0, { kind: "lance", petals: 6, width: 0.36 }); }, at: cpt });
          } else if (chosen.kind === "ghost") {
            ctx.back.push({ paint: (pt) => Fl.bloom(pt, fr, x, y, r, { kind: "ghost", look: "ghost", width: 0.55 }), at: cpt });
          } else {
            const soft = chosen.kind === "soft";
            // The style is drawn as the bloom is painted, first from its own
            // stream, weighed by the painter's mix.
            ctx.blooms.push({ paint: (pt) => Fl.bloom(pt, fr, x, y, r * 0.8, { style: soft ? "soft" : Fl.pickStyle(pt, fr, ["fan", "round"]) }), at: cpt });
          }
        }
      }
      if (placed) {
        counts[chosen.kind] = (counts[chosen.kind] ?? 0) + 1;
        if (chosen.spray === true || chosen.kind === "umbel") sprays++;
      }
    }
    if (!placed) rejected[bi] = true;
  }
  return counts;
}

const DETAIL_BIG: Readonly<Record<string, number>> = { gyps: 3, bud: 2, cyme: 1 };
const DETAIL_SMALL: Readonly<Record<string, number>> = { gyps: 2, floret: 2 };

// Small details close to the stems: buds, florets and little sprays in the
// holes too small for the hole loop, and tendrils ending in a leaflet from
// spare stretches of stem (COMPOSE.curls).
export function details(g: Space, rng: Rng, ctx: GrowContext): void {
  const cfg = ctx.cfg;
  const reach = new ReachMap(g);
  for (const st of ctx.stems) reach.add(st, 4);
  const f = g.f;
  if (f === undefined) throw new Error("grow: details needs the clearance field (Space.field)");
  const nx = g.nx, c = g.c;
  const rejected: boolean[] = [];
  for (let k = 0; k < nx * g.ny; k++) rejected.push(false);
  let made = 0;
  // Each round takes the cell near a stem of greatest clearance, the
  // earliest reached on a tie. Reach is fixed here and clearance only
  // falls, so the cells near enough wait in a heap by the clearance they
  // last had: a round refreshes stale tops until one is current, and
  // looks on through any that could tie it.
  const sdm = reach.sd, heap = new CellHeap(), pos: number[] = [];
  reach.keys.forEach((k, i) => {
    pos[k] = i;
    if (sdm[k] < 22) heap.push(f[k], k);
  });
  const looked: number[] = [];
  for (let iter = 1; iter <= 300; iter++) {
    if (made >= cfg.sprays) break;
    let best = -1, bi = -1;
    looked.length = 0;
    while (heap.size > 0 && !(bi >= 0 && heap.topKey() < best)) {
      const bound = heap.topKey(), k = heap.pop();
      if (rejected[k]) continue;
      const fk = f[k];
      if (fk < bound) {
        heap.push(fk, k);
        continue;
      }
      looked.push(k);
      if (fk > best || (fk === best && pos[k] < pos[bi])) {
        best = fk;
        bi = k;
      }
    }
    for (const k of looked) heap.push(f[k], k);
    if (bi < 0 || best < 3.5) break;
    const x = (mod(bi, nx) + 0.5) * c, y = (Math.floor(bi / nx) + 0.5) * c;
    rejected[bi] = true;
    if (rng.next() < ctx.dens(x, y)) {
      const [s, sd] = reach.nearest(x, y);
      const fr = rng.fork("detail" + fmt(iter, 0));
      const kind = (best >= 6 ? fr.weighted(DETAIL_BIG) : fr.weighted(DETAIL_SMALL)) ?? "gyps";
      const tmp = new S.Batch();
      Fill.grow(tmp, fr, kind, s.p, s.a, sd, x, y, best, 1, 0);
      if (Fill.fits(g, tmp)) {
        ctx.sprays.merge(tmp);
        g.disc(x, y, best, DISC_K);
        made++;
      }
    }
  }
  // Tendrils and loop flourishes leave a stem nearly tangentially and are
  // cut before their tight coil, ending in a leaflet.
  for (const st of ctx.strands) {
    const pts = st.pts;
    // Every 14th point from the 12th to the 12th from the end (1-based in
    // the Lua original).
    for (let i = 11; i <= pts.length - 13; i += 14) {
      const p = pts[i];
      if (rng.next() < cfg.curls * (0.04 + 0.1 * ctx.dens(p[0], p[1]))) {
        const side = rng.chance(0.5) ? 1 : -1;
        const start = G.angle(pts[i - 1], pts[i + 1]) + side * rng.range(0.25, 0.45);
        let curve: Pt[];
        if (rng.chance(0.45)) {
          curve = S.flourish(p, start, rng.range(55, 90), side);
          curve = curve.slice(0, Math.floor(curve.length * 0.8));
        } else {
          curve = S.tendril(p, start, rng.range(30, 55), side);
          curve = curve.slice(0, Math.floor(curve.length * 0.7));
        }
        const n = curve.length;
        if (n >= 4 && openPath(g, curve)) {
          const mid = curve[Math.floor(n / 2) - 1], tip = curve[n - 1];
          if (g.room(mid[0], mid[1]) >= 3 && g.room(tip[0], tip[1]) >= 5) {
            const tipA = G.angle(curve[n - 2], tip);
            const size = cfg.leaflet_size * sample(rng, SIZES.leaflet);
            ctx.sprays.line(curve, 2);
            ctx.leaflets.push([tip[0], tip[1], tipA, Math.min(size, g.room(tip[0], tip[1]) * 1.8)]);
            g.disc(mid[0], mid[1], 3, 1);
            g.disc(tip[0], tip[1], 4, 1);
          }
        }
      }
    }
  }
}
