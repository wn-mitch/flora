// Composes one page of flora, in the order the plant grows: the stems
// (layout.ts, plant.ts), then leaves at their nodes, blooms and sprays on
// branches grown to the largest holes, and small details (grow.ts), then
// ornaments. Painting runs back to front in fixed layers.
import { fmt } from "#platform";
import * as BR from "./brush.ts";
import { mix as mixInk } from "./color.ts";
import { GrowthClock } from "./clock.ts";
import * as Fill from "./fill.ts";
import * as F from "./flower.ts";
import * as FR from "./frames.ts";
import type { Frames, FloraSpec } from "./frames.ts";
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import * as GR from "./grow.ts";
import type { GrowContext, Placed, StemLike } from "./grow.ts";
import * as LA from "./layout.ts";
import * as L from "./leaf.ts";
import * as MX from "./mix.ts";
import * as O from "./ornament.ts";
import type { Sparkle } from "./ornament.ts";
import * as Title from "./orn_title.ts";
import { draw as drawOrnament, pick } from "./ornaments.ts";
import { PAL, Painter, type Lay } from "./paint.ts";
import * as P from "./plant.ts";
import type { Stem } from "./plant.ts";
import { BATCH, BLOOM, GROWN, Progress, TITLE_SHARE } from "./progress.ts";
import { Rng } from "./rng.ts";
import type { Space } from "./space.ts";
import * as S from "./sprig.ts";
import { COMPOSE, HERO, LAYING, PALETTE, PLANT } from "./tune.ts";
import * as TL from "./timeline.ts";
import * as Visitor from "./visitor.ts";

const PI = Math.PI;
// The hero's projected top stays this far inside the paper's edge, pt.
const HERO_TOP = 8;

// Something to paint, and where, for the growth clock; `lays`, when given,
// say how it is laid down (Painter.lay) in place of opening out from `at`.
interface Piece {
  readonly paint: (this: void, pt: Painter) => void;
  readonly at?: Pt;
  readonly lays?: readonly Lay[];
}

// What planting a frame leaves besides its paint: how much of the region
// it filled, the hero bloom [x, y, R], the cartouche's panel [cx, cy, w, h],
// the ghost bloom [x, y, r], motifs placed by kind (with `leaves`, the large
// leaves) and the sparkles strewn. Positions are in the frame's own page.
// `space` and `stems` are the plant's grid and stems, as a GrowthClock
// (clock.ts) is built over them, for a caller that reveals the finished
// page itself.
export interface Planted {
  readonly coverage: number;
  readonly space: Space;
  readonly stems: readonly StemLike[];
  readonly hero: [number, number, number];
  readonly panel?: [number, number, number, number];
  readonly ghost?: [number, number, number];
  readonly counts: Record<string, number>;
  readonly sparkles: Sparkle[];
}

const hasForks = (s: StemLike): s is Stem => (s as Stem).cum !== undefined;

// Plan one plant in its frame's left margin (frames.ts) and paint it onto
// `pt`, through whatever frame pt has set, telling `prog` (when given) how
// far it has got.
export function plant(spec: FloraSpec, pt: Painter, prog: Progress = Progress.of()): Planted {
  const rng = new Rng(spec.seed ?? 1);
  const W = spec.width;
  const edge = spec.edge ?? 16;
  const [g, m] = LA.region(spec);
  const mw = m.x1 - m.x0;
  const top = spec.header_y ?? spec.text.y1;

  const cfg = MX.budget(MX.cfg(COMPOSE, spec.mix), spec.budget);
  const R = G.clamp(mw * cfg.hero, 28, 80);
  // As in the reference, the hero's heart sits just below the running-head
  // rule, so the bloom fills the top corner of the page up to the paper's
  // edge (its projected top kept HERO_TOP pt inside it).
  const rh0 = F.tilt(0, 0, R, HERO.tilt)[1];
  const hy = Math.min(top - R * 0.32, spec.height - HERO_TOP - rh0);
  const hero: [number, number, number] = [G.clamp(m.x0 + mw * 0.5, m.x0 + R * 0.75, m.x1 - R * 0.95), hy, R];
  // The clearance field sees the text and the region's edges from here on.
  g.field();
  // The hero leans back, so its petals cover a flattened oval; it is
  // recorded as three discs across that oval, counted at 0.85 of their
  // radius so foliage may tuck under the rim of its petals.
  g.disc(hero[0], hero[1], F.tilt(hero[0], hero[1], R, HERO.tilt)[1], 0.85);
  for (const sx of [-1, 1]) g.disc(hero[0] + sx * R * 0.45, hero[1], R * 0.55, 0.85);

  const gest = LA.gesture(rng.fork("gesture"), m, hero);
  const dens = MX.density(gest.density, spec.mix);
  // The cartouche's place, at the reference's size, is kept clear before
  // the plant grows, so the stems bend around it as the reference's do.
  const ylo = m.y0, span = hero[1] - m.y0;
  const py = gest.quiet.length > 0 ? gest.quiet[0] : ylo + span * 0.5;
  const [pw, ph] = LA.cartoucheSize(mw);
  const [grown, root] = LA.strands(rng.fork("strands"), m, hero, W, gest, [m.x0, py - ph / 2 - 3, m.x0 + pw + 5, py + ph / 2 + 3]);
  const strands: StemLike[] = grown.slice();
  const excursion = spec.frame_only === true ? undefined : LA.excursion(rng.fork("excursion"), spec, root);
  if (excursion !== undefined) strands.push(excursion);
  // A bare frame (a curved one: frames.ts) has no outer corner, so no
  // corner runner, star panel or foot compass.
  const runners: LA.Strand[] = spec.bare === true ? [] : LA.runners(m, grown[0].pts[0], W, edge, g);
  P.fork(grown[0], 0.005, 0.8);
  const stems: StemLike[] = [];
  const stemBatch = new S.Batch(), sprayBatch = new S.Batch();
  for (const s of strands) {
    g.reserveLine(s.pts, 2, 4);
    stems.push(s);
  }
  for (const s of runners) {
    g.reserveLine(s.pts, 2, 4);
    stems.push(s);
  }

  const orn: Piece[] = [];
  let panel: [number, number, number, number] | undefined;
  // Each slot's kind is drawn by weight (ornaments.ts) from a stream of its
  // own; a slot whose kinds all weigh 0 is left empty.
  const cartouche = spec.bare === true ? undefined : pick(rng.fork("choose cartouche"), "cartouche", spec.ornaments);
  if (cartouche !== undefined) {
    // The star cartouche sits in a quiet stretch, where the stems hug the
    // outer edge and bend around it. It sits against the outer edge, so
    // its own rectangle (with a small pad) is tested rather than a disc
    // round its centre; it is tried at the reference's size, then smaller.
    for (const k of [1.0, 0.82, 0.66]) {
      const [w, h] = LA.cartoucheSize(mw, k);
      const cx = m.x0 + w / 2 + 2;
      let fits = true;
      for (let x = cx - w / 2 - 1; x <= cx + w / 2 + 3; x += 2) {
        for (let y = py - h / 2 - 3; y <= py + h / 2 + 3; y += 2) if (!g.free(x, y)) fits = false;
      }
      if (fits) {
        g.box(cx - w / 2, py - h / 2, cx + w / 2, py + h / 2);
        const r = rng.fork("panel");
        orn.push({ paint: (p) => drawOrnament(cartouche, p, r, [cx - w / 2, py - h / 2, cx + w / 2, py + h / 2]), at: [cx, py] });
        panel = [cx, py, w, h];
        break;
      }
    }
  }
  const ctx: GrowContext = {
    cfg, mix: spec.mix, mw, dens, ylo, span, strands, stems,
    stemBatch, sprays: sprayBatch, blooms: [], back: [], leaves: [], leaflets: [], counts: {},
  };
  // As in the reference, a large ghost bloom usually sits low in the outer
  // margin, just above the foot, behind the stems that cross it. It is
  // recorded at 0.8 of its radius, so leaves and sprays may overlap only its
  // petals' rims, and it takes the hole loop's one ghost.
  let ghost: [number, number, number] | undefined;
  {
    const gr = rng.fork("ghost");
    const gw = MX.weight(spec.mix, "ghost");
    if (gw > 0 && gr.chance(0.85 * Math.min(1, gw))) {
      for (let tries = 0; tries < 8; tries++) {
        const r = mw * gr.range(0.23, 0.28);
        const x = m.x0 + mw * gr.range(0.35, 0.5);
        const y = m.foot + gr.range(35, 75);
        let ok = true;
        for (let k = 0; k <= 11; k++) {
          const q = G.polar([x, y], (k * PI) / 6, r * 0.9);
          const inPanel = panel !== undefined && Math.abs(q[0] - panel[0]) < panel[2] / 2 + 2 && Math.abs(q[1] - panel[1]) < panel[3] / 2 + 2;
          if (!g.openAt(q[0], q[1]) || inPanel) ok = false;
        }
        if (ok) {
          g.disc(x, y, r, 0.8);
          const fr = gr.fork("bloom");
          ctx.back.push({ paint: (p) => F.bloom(p, fr, x, y, r, { kind: "ghost", look: "ghost", width: 0.55 }), at: [x, y] });
          ctx.counts.ghost = 1;
          ghost = [x, y, r];
          break;
        }
      }
    }
  }
  const growRng = rng.fork("grow");
  prog.at(GROWN.laid);
  GR.nodeLeaves(g, growRng.fork("nodes"), strands, ctx);
  GR.tips(g, growRng.fork("tips"), strands, ctx);
  // Visitors claim their space before the holes fill (visitor.ts).
  Visitor.place(g, rng.fork("visitors"), ctx, strands);
  prog.at(GROWN.nodes);

  // Gilt ornaments claim their space before the sprays fill in.
  const headerY = spec.header_y;
  if (headerY !== undefined) {
    const hx = spec.text.x0 - 6, hy = headerY - 3;
    const mark = pick(rng.fork("choose header"), "header", spec.ornaments);
    // The rule is ruled from the mark across the text at an even pace.
    const rule: Pt[] = [[hx + 4, hy], [spec.text.x1, hy]];
    orn.push({
      paint: (p) => {
        p.stroke(G.polyline(rule, false), PAL.ink, 0.4, 0.9);
        if (mark !== undefined) drawOrnament(mark, p, rng.fork("header"), [hx - 13, hy - 13, hx + 13, hy + 13]);
      },
      lays: [
        { at: [hx, hy], start: LAYING.gilt_delay, along: rule, half: 1, dur: G.length(rule) },
        { at: [hx, hy], start: LAYING.gilt_delay, from: [hx, hy], reach: 20 },
      ],
    });
  }
  // A pendant knot hangs in the foot's corner on a cord from the foliage
  // above, at the lowest place with room for it; its size and place vary
  // with the seed.
  const pendant = pick(rng.fork("choose pendant"), "pendant", spec.ornaments);
  if (pendant !== undefined) {
    const r = rng.fork("pendant");
    const w = G.clamp(mw * r.range(0.15, 0.19), 14, 30);
    const h = w * r.range(1.3, 1.5);
    const x = m.x0 + w / 2 + r.range(3, 10);
    const corners: Pt[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let y = m.y0 + h / 2 + 1; y <= m.y0 + 90; y += 3) {
      let clear = g.room(x, y) >= w * 0.3;
      for (const q of corners) if (!g.openAt(x + (q[0] * w) / 2, y + (q[1] * h) / 2)) clear = false;
      if (clear) {
        g.box(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
        let cord = 0;
        while (cord < 40 && g.free(x, y + h / 2 + cord + 2)) cord += 2;
        if (cord >= 6) g.box(x - 1, y + h / 2, x + 1, y + h / 2 + cord);
        else cord = 0;
        const box: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        orn.push({ paint: (p) => drawOrnament(pendant, p, r, box, { cord }), at: [x, y] });
        break;
      }
    }
  }

  // A dotted gilt chain runs down the outer edge wherever the foliage
  // leaves it clear, from below the hero to the foot. A gathered plant's
  // outer edge is its bouquet's middle, where no chain belongs.
  const px = m.x0 + 2.5;
  const runs: [number, number][] = [];
  let run: [number, number] | undefined;
  const heroRh = F.tilt(0, 0, R, HERO.tilt)[1];
  const yEnd = spec.gather !== undefined ? Infinity : m.y0 + 6;
  for (let y = hero[1] - heroRh - 6; y >= yEnd; y -= 2) {
    if (g.free(px, y) && g.free(px - 1.5, y) && g.free(px + 1.5, y)) {
      if (run !== undefined) run[1] = y;
      else run = [y, y];
    } else {
      if (run !== undefined && run[0] - run[1] >= 28) runs.push(run);
      run = undefined;
    }
  }
  if (run !== undefined && run[0] - run[1] >= 28) runs.push(run);
  for (let k = 0; k < runs.length; k++) {
    const rn = runs[k];
    for (let y = rn[0]; y >= rn[1]; y -= 5) g.reserve(px, y, 5);
    const r = rng.fork("chain" + fmt(k + 1, 0));
    // A run stopped by the cartouche's top hangs a knot over it.
    const foot = panel !== undefined && Math.abs(px - panel[0]) < panel[2] / 2 && rn[1] - (panel[1] + panel[3] / 2) < 8 && rn[1] > panel[1] ? "knot" : undefined;
    // The chain is drawn along its run as the front passes it.
    const run: Pt[] = [[px, rn[0]], [px, rn[1]]];
    orn.push({ paint: (p) => O.chain(p, r, px, rn[0], rn[1], foot), lays: [{ at: run[0], start: LAYING.gilt_delay, along: run, half: 8 }] });
  }

  // Blooms and sprays on branches to the largest holes, then details.
  GR.holes(g, growRng.fork("holes"), ctx);
  prog.at(GROWN.holes);
  GR.details(g, growRng.fork("details"), ctx);
  prog.at(GROWN.details);
  if (cfg.no_leaflets !== true) {
    for (const s of strands) {
      for (const it of S.leafletItems(rng, s.pts, cfg.leaflet_spacing, cfg.leaflet_size)) {
        if (g.room(it[0], it[1]) >= it[3] * 0.3 && rng.next() < dens(it[0], it[1])) ctx.leaflets.push(it);
      }
    }
  }
  const sparkles = Fill.sparkles(rng.fork("sparkles"), g, 40, spec.ornaments);
  const midfoot: Pt = [W * 0.66, m.y0 + 10];

  // The plant's stems are drawn once every fork is known, so each narrows
  // where its shoots leave. Its own stems are brushed washes (brush.ts);
  // the corner sprig and the excursion stay pen work.
  const painted: Stem[] = [];
  for (const s of strands) {
    if (hasForks(s)) painted.push(s);
    else if (s.width !== undefined) stemBatch.stemBy(s.pts, s.width);
  }
  for (const s of runners) stemBatch.stemBy(s.pts, s.width);

  // Paint back to front, each element laid down as the growth front
  // reaches it (Painter.lay, timeline.ts) when the painter keeps the
  // timeline or this is a "watch it grow" frame (spec.grow below 1). A
  // frame paints the whole plant with its timeline and keeps only what the
  // front has laid down by then, so every random stream is spent alike and
  // the last frame is the finished page.
  const framing = spec.grow !== undefined && spec.grow < 1;
  const clock = framing || pt.timed ? new GrowthClock(g, stems) : undefined;
  const reach = clock !== undefined ? clock.reach : 0;
  const births0 = pt.births;
  if (clock !== undefined) pt.births = (x, y) => clock.birth(x, y);
  // An element opens out from where it stands, `delay` after the front
  // reaches it, or is laid as its own lays say; one with no place of its
  // own opens from its middle once the stems are grown.
  const draw = (f: Piece, delay = 0): void => {
    const at = f.at, lays = f.lays;
    if (lays !== undefined) pt.lay(lays, () => f.paint(pt));
    else if (at !== undefined) pt.lay([{ at, start: delay, from: at }], () => f.paint(pt));
    else pt.lay([{ start: reach + delay, from: "middle" }], () => f.paint(pt));
  };
  // The painting's units (progress.ts), and a tally of those painted.
  const units = ctx.back.length + painted.length + ctx.leaves.length + BLOOM * ctx.blooms.length + (ctx.visitors ?? []).length + orn.length
    + BATCH.stems + BATCH.sprays + BATCH.leaflets + BATCH.hero + BATCH.finish;
  const painting = prog.part(GROWN.details, 1);
  let done = 0;
  const paid = (n: number): void => {
    done += n;
    painting.at(done / units);
  };
  const paintAll = (): void => {
    for (const f of ctx.back) {
      draw(f);
      paid(1);
    }
    // Bottom to top, as in the reference: stems and sprays, then leaflets,
    // then leaves, then blooms. Each leaf knocks out what lies under it.
    // Stems, sprays, leaflets and leaves lay themselves down.
    const sr = rng.fork("stem paint");
    for (const s of painted) {
      BR.stem(pt, sr, s.pts, s.width, PLANT);
      paid(1);
    }
    stemBatch.paint(pt);
    paid(BATCH.stems);
    // Fine sprays are pen work in a diluted ink, lighter than the stems.
    sprayBatch.paint(pt, mixInk(PAL.ink, PAL.sky, 0.4));
    paid(BATCH.sprays);
    L.leaflets(pt, rng.fork("leaflets"), ctx.leaflets);
    paid(BATCH.leaflets);
    for (const f of ctx.leaves) {
      const at = f.at;
      if (at !== undefined) pt.lay([{ at }], () => f.paint(pt));
      else draw(f);
      paid(1);
    }
    for (const f of ctx.blooms) {
      draw(f, LAYING.bloom_delay);
      paid(BLOOM);
    }
    const heroPiece: Piece = { paint: (p) => F.hero(p, rng.fork("hero"), hero[0], hero[1], hero[2]), at: [hero[0], hero[1]] };
    draw(heroPiece);
    paid(BATCH.hero);
    const visitors: readonly Placed[] = ctx.visitors ?? [];
    for (const f of visitors) {
      draw(f, LAYING.visitor_delay);
      paid(1);
    }
    for (const f of orn) {
      draw(f, LAYING.gilt_delay);
      paid(1);
    }
    // The gilt follows the plant: each sparkle, and the compass, a while
    // after the front reaches it.
    const sl = sparkles.map((sp): Lay => ({ at: [sp.x, sp.y], start: LAYING.gilt_delay, from: [sp.x, sp.y], reach: sp.r * 2 + 1, dur: 12 }));
    if (sl.length > 0) pt.lay(sl, () => O.sparkles(pt, sparkles));
    if (spec.bare !== true) {
      pt.lay([{ at: midfoot, start: LAYING.gilt_delay, from: midfoot }], () => O.compass(pt, midfoot[0], midfoot[1], 7, { hair: 0.9, ring: 0 }));
    }
    paid(BATCH.finish);
  };
  const gu = spec.grow;
  if (clock === undefined) paintAll();
  else pt.recorded(paintAll, framing && gu !== undefined ? (items) => TL.frame(items, gu * TL.end(items)) : undefined);
  pt.births = births0;
  const counts = ctx.counts;
  counts.leaves = ctx.leaves.length;
  return { coverage: g.coverage(), space: g, stems, hero, panel, ghost, counts, sparkles };
}

// A page planned and painted: its painter, how much of its margins the
// plants filled (the frames' mean), its layout's frames, and each frame's
// plant.
export interface Page {
  readonly pt: Painter;
  readonly coverage: number;
  readonly frames: Frames;
  readonly planted: Planted[];
}

// Plan and paint a page. spec: width, height, text = {x0, y0, x1, y1},
// optional lines, header_y, seed, edge, layout (frames.ts) with page and
// title, palette and spin, mix, grow and backdrop. onFrame, when given, is
// told each frame before its plant is painted. o.painter, when given, is
// painted onto instead of a new painter made for the page's palette, mix
// and backdrop. o.progress, when given, is told how much of the page is
// done (0 to 1, rising, by about 0.01 at a time and ending in 1), at the
// same points and with the same values as tikz-flora's compose.lua.
export interface PageOptions {
  readonly onFrame?: (this: void, f: FR.Frame) => void;
  readonly progress?: (this: void, f: number) => void;
  readonly painter?: Painter;
}

export function page(spec: FloraSpec, o: PageOptions = {}): Page {
  const onFrame = o.onFrame;
  const pt = o.painter ?? painterFor(spec);
  const frames = FR.of(spec);
  const planted: Planted[] = [];
  const prog = Progress.of(o.progress);
  // What a layout paints under its plants (the scrollwork's band), there
  // from the start; with the timeline, what it paints over them (the
  // title furniture, the bouquet's ribbons) is laid down once they are,
  // spreading from its middle.
  const before = frames.before;
  if (before !== undefined) pt.lay([{}], () => before(pt));
  const last = (fn: () => void): void => {
    if (pt.timed) pt.lay([{ start: TL.end(pt.scene().items), from: "middle" }], fn);
    else fn();
  };
  // The plants share the page's progress equally; title furniture, when
  // painted, takes TITLE_SHARE of it after them.
  const titled = frames.title !== undefined && (spec.grow ?? 1) >= 0.9;
  const share = titled ? 1 - TITLE_SHARE : 1;
  const n = frames.frames.length;
  frames.frames.forEach((f, k) => {
    onFrame?.(f);
    pt.frame(f.fn);
    planted.push(plant(f.spec, pt, prog.part((share * k) / n, (share * (k + 1)) / n)));
  });
  pt.frame(undefined);
  // Title furniture paints over the finished crowns, in page coordinates;
  // while the page grows it waits for the plants.
  const title = frames.title;
  if (titled && title !== undefined) last(() => Title.paint(pt, spec, title));
  // What a layout paints over its plants (the bouquet's ribbons, the
  // scrollwork's head and foot).
  const after = frames.after;
  if (after !== undefined) last(() => after(pt));
  prog.at(1);
  let coverage = 0;
  for (const p of planted) coverage += p.coverage / planted.length;
  return { pt, coverage, frames, planted };
}

// A painter for page `spec`: its size, backdrop, mix, and its palette with
// any "random" part drawn for the seed and spin.
export function painterFor(spec: FloraSpec): Painter {
  const resolved = MX.resolve(spec.palette, spec.seed, spec.spin);
  const palette = resolved === undefined ? PALETTE : { ...PALETTE, ...resolved };
  return new Painter({ width: spec.width, height: spec.height, backdrop: spec.backdrop, palette, mix: spec.mix });
}
