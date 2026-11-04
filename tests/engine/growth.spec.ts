// Visitors keep to open margin and follow the mix; the growth clock's
// birth times spread from the root.
import { GrowthClock } from "../../src/engine/clock.ts";
import * as G from "../../src/engine/geom.ts";
import type { Pt } from "../../src/engine/geom.ts";
import * as GR from "../../src/engine/grow.ts";
import * as LA from "../../src/engine/layout.ts";
import * as MX from "../../src/engine/mix.ts";
import { PAL, Painter } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";
import * as S from "../../src/engine/sprig.ts";
import type { Space } from "../../src/engine/space.ts";
import * as VI from "../../src/engine/visitor.ts";
import { check, eq, near, test, throws } from "./harness.ts";
import { bodySpec, growPage, numbers } from "./scenes.ts";

const ALL = { bee: 4, butterfly: 3, bird: 2, snail: 3 };

// A page grown as compose orders it, with visitors placed after the
// leaves and tips and before the holes fill.
function visitedPage(seed: string, mix?: MX.Mix): [Space, GR.GrowContext] {
  const spec = bodySpec();
  const hero = [84.5, 606, 68.5] as const;
  const [g, m] = LA.region(spec);
  g.field();
  const gest = LA.gesture(new Rng(seed).fork("gesture"), m, hero);
  const [strands] = LA.strands(new Rng(seed).fork("strands"), m, hero, spec.width, gest, [16, 300, 66, 370]);
  for (const st of strands) g.reserveLine(st.pts, 2, 4);
  const ctx: GR.GrowContext = {
    cfg: MX.cfg(undefined, mix), mix, mw: m.x1 - m.x0, dens: MX.density(gest.density, mix), ylo: m.y0, span: hero[1] - m.y0,
    strands, stems: strands, stemBatch: new S.Batch(), sprays: new S.Batch(), blooms: [], back: [], leaves: [], leaflets: [], counts: {},
  };
  const r = new Rng(seed).fork("grow");
  GR.nodeLeaves(g, r.fork("nodes"), strands, ctx);
  GR.tips(g, r.fork("tips"), strands, ctx);
  VI.place(g, new Rng(seed).fork("visitors"), ctx, strands);
  GR.holes(g, r.fork("holes"), ctx);
  GR.details(g, r.fork("details"), ctx);
  return [g, ctx];
}

test("visitors land in the margin, never on the text, each kind within its most", () => {
  const [fresh] = LA.region(bodySpec());
  const seen: Record<string, number> = {};
  for (const seed of ["v1", "v2", "v3", "v4"]) {
    const [, ctx] = visitedPage(seed, { bee: 50, butterfly: 50, bird: 50, snail: 50 });
    const vs = ctx.visitors ?? [];
    check(vs.length > 0, "a page with every weight up gets visitors");
    for (const v of vs) {
      check(fresh.openAt(v.at[0], v.at[1]), "a visitor stands in open margin");
      check(!fresh.textAt(v.at[0], v.at[1]), "no visitor on the text");
    }
    for (const k of MX.VISITORS) {
      const n = ctx.counts[k] ?? 0;
      check(n <= VI.KINDS[k].most, "at most `most` of each kind, whatever the weight");
      seen[k] = (seen[k] ?? 0) + n;
    }
    eq(vs.length, MX.VISITORS.reduce((a, k) => a + (ctx.counts[k] ?? 0), 0), "counts add up to the visitors placed");
  }
  for (const k of MX.VISITORS) check((seen[k] ?? 0) > 0, "every kind comes to some page");
});

test("a bee's flight path stops before it leaves free space", () => {
  const ok = (x: number, y: number) => x * x + y * y < 25 * 25;
  for (const seed of ["t1", "t2", "t3"]) {
    const path = VI.trail(new Rng(seed), 0, 0, 0.4, 18, ok);
    check(path.length < 70, "the disc cuts the path short");
    for (const p of path) check(ok(p[0], p[1]), "every point of the path is free");
    for (let i = 1; i < path.length; i++) near(G.dist(path[i - 1], path[i]), 2.2, 1e-9, "steps of 2.2 pt");
  }
});

test("visitor weights of 0 leave the page exactly as without visitors", () => {
  const [g0, plain] = growPage("quiet");
  const [g1, zero] = visitedPage("quiet", { bee: 0, butterfly: 0, bird: 0, snail: 0 });
  eq(zero.visitors === undefined, true, "no visitor list");
  eq(g1.coverage(), g0.coverage(), "the same coverage");
  eq(zero.leaves.length, plain.leaves.length, "the same leaves");
  eq(zero.sprays.florets.length, plain.sprays.florets.length, "the same sprays");
});

test("birth times start at 0 at the root and grow no faster than distance", () => {
  const [g, ctx] = growPage("clock");
  const k = new GrowthClock(g, ctx.strands);
  const main = ctx.strands[0].pts;
  eq(k.birth(main[0][0], main[0][1]), 0, "born at once at the root");
  let arc = 0;
  for (let i = 1; i < main.length; i++) {
    arc += G.dist(main[i - 1], main[i]);
    check(k.birth(main[i][0], main[i][1]) <= arc + 1e-9, "a point on the main stem is born by its arc length");
  }
  const end = main[main.length - 1];
  check(k.birth(end[0], end[1]) > k.birth(main[0][0], main[0][1]) + 100, "the main stem's tip is born well after its root");
  // Neighbouring cells differ by at most a diagonal step: the field is a
  // shortest-path distance over the grid.
  const c = g.c, step = c * Math.sqrt(2) + 1e-9;
  for (let j = 0; j < g.ny - 1; j += 3) {
    for (let i = 0; i < g.nx - 1; i += 3) {
      const x = (i + 0.5) * c, y = (j + 0.5) * c, b = k.birth(x, y);
      check(Math.abs(k.birth(x + c, y) - b) <= step && Math.abs(k.birth(x, y + c) - b) <= step && Math.abs(k.birth(x + c, y + c) - b) <= step, "a smooth field");
    }
  }
  let last = 0;
  for (const s of ctx.strands) last = Math.max(last, (k.stemStart(s) ?? -1e9) + G.length(s.pts));
  near(k.reach, last, 1e-6, "the reach is where the last stem ends");
  eq(k.stemStart(ctx.strands[0]) ?? -1, 0, "the main stem starts at once");
  check(k.stemStart({ pts: [[0, 0], [1, 1]] }) === undefined, "a stem the clock was not built with has no start");
  // Off the grid, birth clamps to the nearest edge cell.
  eq(k.birth(-50, -50), k.birth(0.5, 0.5), "clamped below");
  eq(k.birth(1e4, 1e4), k.birth(g.w - 0.01, g.h - 0.01), "clamped above");
});
