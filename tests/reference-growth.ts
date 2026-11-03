// Reference cases for a page's visitors (visitor.ts) and its growth clock
// (clock.ts), run here and against tikz-flora's visitor.lua and clock.lua
// by tests/reference.ts. Each grows the same body page in both: leaves at
// the nodes, tips, visitors, holes and details, as compose orders them.
import * as BR from "../src/engine/brush.ts";
import { GrowthClock } from "../src/engine/clock.ts";
import * as G from "../src/engine/geom.ts";
import type { Pt } from "../src/engine/geom.ts";
import * as GR from "../src/engine/grow.ts";
import * as LA from "../src/engine/layout.ts";
import * as LF from "../src/engine/leaf.ts";
import * as MX from "../src/engine/mix.ts";
import { PAL, type Painter } from "../src/engine/paint.ts";
import { Rng } from "../src/engine/rng.ts";
import * as SP from "../src/engine/sprig.ts";
import type { Space } from "../src/engine/space.ts";
import { PLANT } from "../src/engine/tune.ts";
import * as VI from "../src/engine/visitor.ts";
import { CASES, lit, scene } from "./reference-cases.ts";

const lines = Array.from({ length: 48 }, (_, i) => ({ x0: 162, x1: i === 47 ? 300 : 436, y0: 712 - 12 * i, y1: 720 - 12 * i }));
const spec = { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
const hero = [84.5, 606, 68.5] as const;
// Every visitor kind enabled, at weights that bring each at least once.
const ALL = { bee: 4, butterfly: 3, bird: 2, snail: 3 };

interface Page {
  readonly g: Space;
  readonly ctx: GR.GrowContext;
  readonly strands: readonly GR.StemLike[];
}

function page(seed: string, mix?: MX.Mix): Page {
  const [g, m] = LA.region(spec);
  g.field();
  const gest = LA.gesture(new Rng(seed).fork("gesture"), m, hero);
  const [strands] = LA.strands(new Rng(seed).fork("strands"), m, hero, 595, gest, [16, 300, 66, 370]);
  for (const st of strands) g.reserveLine(st.pts, 2, 4);
  const ctx: GR.GrowContext = {
    cfg: MX.cfg(undefined, mix), mix, mw: m.x1 - m.x0, dens: MX.density(gest.density, mix), ylo: m.y0, span: hero[1] - m.y0,
    strands, stems: strands, stemBatch: new SP.Batch(), sprays: new SP.Batch(), blooms: [], back: [], leaves: [], leaflets: [], counts: {},
  };
  const r = new Rng(seed).fork("grow");
  GR.nodeLeaves(g, r.fork("nodes"), strands, ctx);
  GR.tips(g, r.fork("tips"), strands, ctx);
  VI.place(g, new Rng(seed).fork("visitors"), ctx, strands);
  GR.holes(g, r.fork("holes"), ctx);
  GR.details(g, r.fork("details"), ctx);
  return { g, ctx, strands };
}

// The same page in Lua: page(seed, mix) returns g, ctx, strands and pos,
// where each placed painter stands.
const LUA_PAGE = `
local VI = require("flora.visitor")
local function page(seed, mix)
  local spec = ${lit(spec)}
  local hero = ${lit(hero)}
  local g, m = LA.region(spec)
  g:field()
  local gest = LA.gesture(R.new(seed):fork("gesture"), m, hero)
  local strands = LA.strands(R.new(seed):fork("strands"), m, hero, 595, gest, {16, 300, 66, 370})
  for _, st in ipairs(strands) do g:reserve_line(st.pts, 2, 4) end
  local pos = {}
  local ctx = { cfg = MX.cfg(TU.compose, mix), mix = mix, pos = pos, mw = m.x1 - m.x0, dens = MX.density(gest.density, mix), ylo = m.y0, span = hero[2] - m.y0,
    strands = strands, stems = strands, stem_batch = SP.batch(), sprays = SP.batch(), blooms = {}, back = {}, leaves = {}, leaflets = {}, counts = {} }
  local r = R.new(seed):fork("grow")
  MX.with_mix(mix, function()
    GR.node_leaves(g, r:fork("nodes"), strands, ctx)
    GR.tips(g, r:fork("tips"), strands, ctx)
    VI.place(g, R.new(seed):fork("visitors"), ctx, strands)
    GR.holes(g, r:fork("holes"), ctx)
    GR.details(g, r:fork("details"), ctx)
  end)
  return g, ctx, strands, pos
end
local function at(list, pos) local t = {}; for i, f in ipairs(list or {}) do t[i] = pos[f] end; return t end
`;

const add = (name: string, ts: () => unknown, lua: string) => CASES.push({ name, ts, lua });

// Placement: how many of each kind came, where each stands, the birds'
// twigs, and what the rest of the page grew around them.
const ribbons = (b: SP.Batch) => b.ribbons;
for (const [seed, mix] of [["visit 1", ALL], ["visit 2", ALL], ["visit 3", { butterfly: 1.5, snail: 1 }], ["visit 4", undefined]] as const) {
  add(`visitor place ${seed}`, () => {
    const { g, ctx } = page(seed, mix);
    return [MX.VISITORS.map((k) => ctx.counts[k] ?? 0), (ctx.visitors ?? []).map((v) => v.at), ribbons(ctx.stemBatch), ctx.leaves.map((l) => l.at), ctx.blooms.map((b) => b.at), g.coverage()];
  }, `(function() ${LUA_PAGE}
    local g, ctx, strands, pos = page(${lit(seed)}, ${mix ? lit(mix) : "nil"})
    local counts = {}
    for i, k in ipairs(MX.visitors) do counts[i] = ctx.counts[k] or 0 end
    return {counts, at(ctx.visitors, pos), ctx.stem_batch.ribbons, at(ctx.leaves, pos), at(ctx.blooms, pos), g:coverage()}
  end)()`);
}

// Each kind painted on its own, then every visitor a page placed.
scene("paint visitor bee", (pt) => { VI.bee(pt, new Rng("bee"), 120, 140, 0.7, 18); VI.paintTrail(pt, [[10, 10], [12, 11], [14, 13], [16, 16]]); },
  `local VI = require("flora.visitor"); VI.bee(pt, R.new("bee"), 120, 140, 0.7, 18); VI.paint_trail(pt, {{10, 10}, {12, 11}, {14, 13}, {16, 16}})`);
add("visitor trail", () => VI.trail(new Rng("trail"), 150, 150, 2.1, 18, (x, y) => x > 60),
  `require("flora.visitor").trail(R.new("trail"), 150, 150, 2.1, 18, function(x, y) return x > 60 end)`);
for (const open of [1, 0.75]) {
  scene(`paint visitor butterfly ${open}`, (pt) => VI.butterfly(pt, new Rng("bf"), 150, 150, 1.9, 38, open),
    `require("flora.visitor").butterfly(pt, R.new("bf"), 150, 150, 1.9, 38, ${open})`);
}
for (const dir of [1, -1]) {
  scene(`paint visitor bird ${dir}`, (pt) => VI.bird(pt, new Rng("bird"), 150, 120, dir, 45),
    `require("flora.visitor").bird(pt, R.new("bird"), 150, 120, ${dir}, 45)`);
}
for (const side of [1, -1]) {
  scene(`paint visitor snail ${side}`, (pt) => VI.snail(pt, new Rng("snail"), 150, 120, 1.2, side, 28),
    `require("flora.visitor").snail(pt, R.new("snail"), 150, 120, 1.2, ${side}, 28)`);
}
scene("paint visitors visit 1", (pt) => { for (const v of page("visit 1", ALL).ctx.visitors ?? []) v.paint(pt); },
  `${LUA_PAGE}; local g, ctx = page("visit 1", ${lit(ALL)}); for _, f in ipairs(ctx.visitors) do f(pt) end`);

// The clock on a grown page: its reach, birth times on a grid of probes
// (some off the page, which clamp to its edge), what born answers there,
// and which sparkles have arrived.
const probes: Pt[] = [];
for (let x = -20; x <= 620; x += 37) for (let y = -15; y <= 860; y += 41) probes.push([x, y]);
const sparkles = Array.from({ length: 12 }, (_, i) => ({ x: 20 + i * 9, y: 30 + i * 7, r: 2 }));
for (const T of [0, 0.3, 0.7, 0.9]) {
  add(`clock field ${T}`, () => {
    const { g, strands } = page("clock", ALL);
    const k = new GrowthClock(g, strands, T);
    return [k.reach, k.span, k.u, probes.map((p) => k.birth(p[0], p[1])), probes.map((p) => k.born(p[0], p[1])), k.sparkles(sparkles).map((s) => [s.x, s.y, s.r])];
  }, `(function() ${LUA_PAGE}
    local CK = require("flora.clock")
    local g, ctx, strands = page("clock", ${lit(ALL)})
    local k = CK.new(g, strands, ${T})
    local b, n = {}, {}
    for i, p in ipairs(${lit(probes)}) do b[i] = k:birth(p[1], p[2]); n[i] = k:born(p[1], p[2]) end
    return {k.reach, k.span, k.u, b, n, k:sparkles(${lit(sparkles.map((s) => [s.x, s.y, s.r]))})}
  end)()`);
}

// Frames: the stems revealed up to the front, leaflets unfurling one by
// one, and drawn elements (leaves, then visitors after their delay) grown
// from their anchors. The leaflets are the batched kind (a flower's
// sepals): washed leaflets differ from the Lua on purpose (see "paint
// leaflets" in reference-cases.ts, tikz-flora TASK-40).
const clockLua = (T: number, body: string) => `${LUA_PAGE}
  local CK = require("flora.clock")
  local g, ctx, strands, pos = page("clock", ${lit(ALL)})
  local k = CK.new(g, strands, ${T})
  ${body}`;
const clockTs = (T: number, fn: (pt: Painter, k: GrowthClock, p: Page) => void) => (pt: Painter) => {
  const p = page("clock", ALL);
  fn(pt, new GrowthClock(p.g, p.strands, T), p);
};
// Brush.stem resamples a stem at floor(length / 3) points. Many strands
// are exactly a whole number of 3 pt steps long, where Node and Lua sum
// the length an ulp apart and so resample at different counts; the stem
// scenes paint only the strands away from that boundary (the clock is
// still built over every strand).
const offBoundary = (pts: readonly Pt[]) => {
  const q = G.length(pts) / 3;
  return Math.abs(q - Math.floor(q + 0.5)) >= 1e-9;
};
for (const T of [0.3, 0.7]) {
  scene(`paint clock stems ${T}`, clockTs(T, (pt, k, p) => {
    const sr = new Rng("stem paint");
    for (const s of p.strands) if (offBoundary(s.pts)) k.stem(pt, s, PLANT.root_width, (q) => BR.stem(q, sr, s.pts, s.width ?? (() => 1), PLANT));
  }), clockLua(T, `local sr = R.new("stem paint")
    for _, s in ipairs(strands) do
      local q = G.length(s.pts) / 3
      if math.abs(q - math.floor(q + 0.5)) >= 1e-9 then k:stem(pt, s, TU.plant.root_width, function(p) BR.stem(p, sr, s.pts, s.width, TU.plant) end) end
    end`));
  scene(`paint clock leaflets ${T}`, clockTs(T, (pt, k, p) => {
    k.leaflets(pt, new Rng("leaflets"), p.ctx.leaflets.slice(0, 40), (q, r, items) => LF.leaflets(q, r, items, PAL.deep, 0.9));
  }), clockLua(T, `local items = {}
    for i = 1, math.min(40, #ctx.leaflets) do items[i] = ctx.leaflets[i] end
    k:leaflets(pt, R.new("leaflets"), items, function(p, r, its) LF.leaflets(p, r, its, PAINT.palette.deep, 0.9) end)`));
  scene(`paint clock leaves ${T}`, clockTs(T, (pt, k, p) => {
    for (const l of p.ctx.leaves) k.draw(pt, l.paint, l.at, 0.06);
  }), clockLua(T, "for _, f in ipairs(ctx.leaves) do k:draw(pt, f, pos[f], 0.06) end"));
  scene(`paint clock visitors ${T}`, clockTs(T, (pt, k, p) => {
    for (const v of p.ctx.visitors ?? []) k.draw(pt, v.paint, v.at, 0.08, k.reach * 0.25);
    k.draw(pt, (q) => q.stroke([["m", 10, 10], ["l", 40, 30]], PAL.ink, 1), undefined, 0.15);
  }), clockLua(T, `for _, f in ipairs(ctx.visitors) do k:draw(pt, f, pos[f], 0.08, k.reach * 0.25) end
    k:draw(pt, function(p) p:stroke({{"m", 10, 10}, {"l", 40, 30}}, PAINT.palette.ink, 1) end, nil, 0.15)`));
}
