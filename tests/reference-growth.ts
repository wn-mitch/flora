// Reference cases for a page's visitors (visitor.ts) and its growth clock
// (clock.ts), run here and against tikz-flora's visitor.lua and clock.lua
// by tests/reference.ts. Each grows the same body page in both: leaves at
// the nodes, tips, visitors, holes and details, as compose orders them.
import { GrowthClock } from "../src/engine/clock.ts";
import * as G from "../src/engine/geom.ts";
import type { Pt } from "../src/engine/geom.ts";
import * as GR from "../src/engine/grow.ts";
import * as LA from "../src/engine/layout.ts";
import * as MX from "../src/engine/mix.ts";
import { Rng } from "../src/engine/rng.ts";
import * as SP from "../src/engine/sprig.ts";
import type { Space } from "../src/engine/space.ts";
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

// The clock on a grown page: its reach and birth times on a grid of probes
// (some off the page, which clamp to its edge). Frames are no longer
// compared: flora lays each stroke down (timeline.ts), where tikz-flora's
// clock clips stems and scales elements.
const probes: Pt[] = [];
for (let x = -20; x <= 620; x += 37) for (let y = -15; y <= 860; y += 41) probes.push([x, y]);
add("clock field", () => {
  const { g, strands } = page("clock", ALL);
  const k = new GrowthClock(g, strands);
  return [k.reach, probes.map((p) => k.birth(p[0], p[1]))];
}, `(function() ${LUA_PAGE}
  local CK = require("flora.clock")
  local g, ctx, strands = page("clock", ${lit(ALL)})
  local k = CK.new(g, strands, 1)
  local b = {}
  for i, p in ipairs(${lit(probes)}) do b[i] = k:birth(p[1], p[2]) end
  return {k.reach, b}
end)()`);
