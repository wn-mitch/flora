// The cases tests/reference.ts runs both here and in tikz-flora's Lua: each
// pairs a call on the engine with the same call as a Lua expression over
// tikz-flora's modules R (rng), G (geom), C (color) and S (space). Inputs
// come from a fixed stream, so every run checks the same cases.
import * as C from "../src/engine/color.ts";
import * as D from "../src/engine/dist.ts";
import * as F from "../src/engine/flower.ts";
import * as GR from "../src/engine/grow.ts";
import * as LA from "../src/engine/layout.ts";
import * as MX from "../src/engine/mix.ts";
import * as SP from "../src/engine/sprig.ts";
import { SIZES } from "../src/engine/tune.ts";
import * as G from "../src/engine/geom.ts";
import { hash, Rng } from "../src/engine/rng.ts";
import { CORRIDOR, Space } from "../src/engine/space.ts";
import type { Pt } from "../src/engine/geom.ts";

export interface Case {
  readonly name: string;
  readonly ts: () => unknown;
  readonly lua: string;
  // The largest relative difference allowed; default 1e-12.
  readonly tol?: number;
}

// A JavaScript value as a Lua literal. Numbers print exactly (shortest
// round-trip form); strings byte by byte.
export function lit(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`lit: ${v}`);
    return Object.is(v, -0) ? "-0.0" : String(v);
  }
  if (typeof v === "string") return '"' + [...new TextEncoder().encode(v)].map((b) => "\\" + b).join("") + '"';
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return "{" + v.map(lit).join(", ") + "}";
  if (v && typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `[${lit(k)}] = ${lit(x)}`).join(", ") + "}";
  throw new Error(`lit: cannot write ${String(v)}`);
}

export const CASES: Case[] = [];
const add = (name: string, ts: () => unknown, lua: string, tol?: number) => CASES.push({ name, ts, lua, tol });

const gen = new Rng("reference cases");
const num = (a: number, b: number) => gen.range(a, b);
const point = (s = 200): Pt => [num(-s, s), num(-s, s)];
const points = (n: number, s = 200): Pt[] => Array.from({ length: n }, () => point(s));
// A star-shaped polygon round (cx, cy): simple, with n vertices.
const blob = (n: number, r: number): Pt[] => {
  const cx = num(-50, 50), cy = num(-50, 50);
  return Array.from({ length: n }, (_, i): Pt => {
    const a = (i / n) * 2 * Math.PI, rr = r * num(0.5, 1.2);
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  });
};
// A wandering polyline.
const walk = (n: number): Pt[] => {
  let x = num(-50, 50), y = num(-50, 50), a = num(0, 6.28);
  return Array.from({ length: n }, (): Pt => {
    a += num(-0.6, 0.6);
    x += 6 * Math.cos(a);
    y += 6 * Math.sin(a);
    return [x, y];
  });
};

// Random streams: exact, draw for draw.
const SEEDS: (number | string)[] = [0, 1, 42, 4294967295, 4294967296 + 5, -7, 2.9, "leaf", "é", "garden 20261102"];
for (const seed of SEEDS) {
  add(`rng next ${String(seed)}`, () => { const r = new Rng(seed); return Array.from({ length: 40 }, () => r.next()); }, `draws(R.new(${lit(seed)}), 40, "next")`, 0);
}
for (const s of ["", "a", "leaf", "flower:12345", "é🌼"]) add(`rng hash ${s}`, () => hash(s), `R.hash(${lit(s)})`, 0);
add("rng int", () => { const r = new Rng(9); return Array.from({ length: 60 }, () => r.int(-3, 7)); }, `draws(R.new(9), 60, "int", -3, 7)`, 0);
add("rng range", () => { const r = new Rng(10); return Array.from({ length: 30 }, () => r.range(2, 5.5)); }, `draws(R.new(10), 30, "range", 2, 5.5)`, 0);
add("rng jit", () => { const r = new Rng(11); return Array.from({ length: 30 }, () => r.jit(0.3)); }, `draws(R.new(11), 30, "jit", 0.3)`, 0);
add("rng chance", () => { const r = new Rng(12); return Array.from({ length: 60 }, () => r.chance(0.3)); }, `draws(R.new(12), 60, "chance", 0.3)`, 0);
add("rng normal", () => { const r = new Rng(13); return Array.from({ length: 30 }, () => r.normal(1, 2)); }, `draws(R.new(13), 30, "normal", 1, 2)`);
add("rng pick", () => { const r = new Rng(14); return Array.from({ length: 40 }, () => r.pick(["a", "b", "c", "d"])); }, `draws(R.new(14), 40, "pick", {"a", "b", "c", "d"})`, 0);
const WEIGHTS: Record<string, number>[] = [{ gyps: 3, bud: 2, cyme: 1 }, { plain: 2, broken: 3, oxford: 2, triple: 2 }, { a: 0, b: 1 }, { a: 0 }];
for (const w of WEIGHTS) {
  add(`rng weighted ${Object.keys(w).join("/")}`, () => { const r = new Rng(15); return Array.from({ length: 50 }, () => r.weighted(w) ?? null); }, `draws(R.new(15), 50, "weighted", ${lit(w)})`, 0);
}
add("rng fork", () => { const r = new Rng(16); r.next(); return ["leaf3", "kind", "é"].map((l) => { const f = r.fork(l); return [f.seed, f.next(), f.next()]; }); },
  `(function() local r = R.new(16); r:next(); local out = {}; for i, l in ipairs({"leaf3", "kind", "\\195\\169"}) do local f = r:fork(l); out[i] = {f.seed, f:next(), f:next()} end; return out end)()`, 0);
add("rng clone", () => { const r = new Rng(17); r.next(); const c = r.clone(); return [r.next(), c.next(), c.next(), r.next()]; },
  `(function() local r = R.new(17); r:next(); local c = r:clone(); return {r:next(), c:next(), c:next(), r:next()} end)()`, 0);

// Geometry.
for (let k = 0; k < 6; k++) {
  const poly = blob(5 + k * 4, 60);
  const line = walk(4 + k * 5);
  const tension = num(0.5, 1.5);
  add(`geom smooth closed ${k}`, () => G.smooth(poly, true, tension), `G.smooth(${lit(poly)}, true, ${lit(tension)})`);
  add(`geom smooth open ${k}`, () => G.smooth(line, false), `G.smooth(${lit(line)}, false)`);
  add(`geom polyline ${k}`, () => G.polyline(line, k % 2 === 0), `G.polyline(${lit(line)}, ${lit(k % 2 === 0)})`);
  add(`geom spline ${k}`, () => G.splinePoints(line, 3 + k), `G.spline_points(${lit(line)}, ${lit(3 + k)})`);
  add(`geom length ${k}`, () => G.length(line), `G.length(${lit(line)})`);
  add(`geom at ${k}`, () => [-0.2, 0, 0.3, 0.77, 1, 1.4].map((t) => G.at(line, t)), `(function() local out = {} for i, t in ipairs({-0.2, 0, 0.3, 0.77, 1, 1.4}) do out[i] = {G.at(${lit(line)}, t)} end return out end)()`);
  add(`geom resample ${k}`, () => G.resample(line, 7 + k), `G.resample(${lit(line)}, ${lit(7 + k)})`);
  add(`geom ribbon ${k}`, () => G.ribbon(line, (t) => 1 + 2 * t * (1 - t)), `G.ribbon(${lit(line)}, function(t) return 1 + 2 * t * (1 - t) end)`);
  add(`geom deform ${k}`, () => G.deform(poly, new Rng(100 + k), 2.5), `G.deform(${lit(poly)}, R.new(${lit(100 + k)}), 2.5)`);
  add(`geom area ${k}`, () => [G.area(poly), G.centroid(poly), G.bbox(poly)], `{G.area(${lit(poly)}), G.centroid(${lit(poly)}), {G.bbox(${lit(poly)})}}`);
  const probes = points(40, 120);
  add(`geom inside ${k}`, () => probes.map(([x, y]) => G.inside(poly, x, y)), `(function() local out = {} for i, p in ipairs(${lit(probes)}) do out[i] = G.inside(${lit(poly)}, p[1], p[2]) end return out end)()`, 0);
  add(`geom sampler ${k}`, () => { const s = G.spanSampler(poly, 1.5 + k)!; const r = new Rng(200 + k); return Array.from({ length: 40 }, () => s(r) ?? null); },
    `(function() local s = G.span_sampler(${lit(poly)}, ${lit(1.5 + k)}); local r = R.new(${lit(200 + k)}); local out = {} for i = 1, 40 do local x, y = s(r); out[i] = x and {x, y} or NULL end return out end)()`);
  const xs = [-3.7, -0.5, 0, 0.25, 7.9, 63.5, 64, 130.2];
  add(`geom noise ${k}`, () => { const n = G.noise(new Rng(300 + k), 8 + k); const f = G.fbm(new Rng(400 + k), 16); return xs.map((x) => [n(x), f(x)]); },
    `(function() local n = G.noise(R.new(${lit(300 + k)}), ${lit(8 + k)}); local f = G.fbm(R.new(${lit(400 + k)}), 16); local out = {} for i, x in ipairs(${lit(xs)}) do out[i] = {n(x), f(x)} end return out end)()`);
  const [p, q] = [point(), point()], [a1, a2] = [num(-7, 7), num(-7, 7)];
  add(`geom curve ${k}`, () => G.curve(p, a1, 80, 0.6, k * 0.3, 10 + k), `G.curve(${lit(p)}, ${lit(a1)}, 80, 0.6, ${lit(k * 0.3)}, ${lit(10 + k)})`);
  add(`geom flow ${k}`, () => G.flow(p, a1, 60 + k * 20, (t) => 0.02 + 0.05 * t * t), `{G.flow(${lit(p)}, ${lit(a1)}, ${lit(60 + k * 20)}, function(t) return 0.02 + 0.05 * t * t end)}`);
  add(`geom link ${k}`, () => G.link(p, a1, q, a2, 0.4), `G.link(${lit(p)}, ${lit(a1)}, ${lit(q)}, ${lit(a2)}, 0.4)`);
  add(`geom turn ${k}`, () => [G.turn(a1, a2), G.turn(a2, a1), G.turn(a1, a1 + 2 * Math.PI), G.depart(p, a1, q), G.depart(p, a1, q, 0.7)],
    `{G.turn(${lit(a1)}, ${lit(a2)}), G.turn(${lit(a2)}, ${lit(a1)}), G.turn(${lit(a1)}, ${lit(a1)} + 2 * math.pi), G.depart(${lit(p)}, ${lit(a1)}, ${lit(q)}), G.depart(${lit(p)}, ${lit(a1)}, ${lit(q)}, 0.7)}`);
  add(`geom transform ${k}`, () => [G.transform(poly, 3, -4, a1, 1.5), G.transform(poly, 0, 0, a2, 0.5, 2), G.toward(poly, 1, 2, 0.8)],
    `{G.transform(${lit(poly)}, 3, -4, ${lit(a1)}, 1.5), G.transform(${lit(poly)}, 0, 0, ${lit(a2)}, 0.5, 2), G.toward(${lit(poly)}, 1, 2, 0.8)}`);
  const guide = walk(30);
  add(`geom pursue ${k}`, () => { const f = G.follow(guide, 12); return G.pursue(guide[0], a1, (q) => f(q), { len: 150, step: 2, kmax: 1 / 20 }); },
    `(function() local f = G.follow(${lit(guide)}, 12); return {G.pursue(${lit(guide[0])}, ${lit(a1)}, function(q) return f(q) end, {len = 150, step = 2, kmax = 1 / 20})} end)()`, 1e-9);
}

// Colour.
const colours: [number, number, number][] = Array.from({ length: 40 }, () => [num(0.05, 0.98), num(0, 0.3), num(0, 360)]);
add("color oklch", () => colours.map(([L, c, h]) => C.oklch(L, c, h)), `(function() local out = {} for i, v in ipairs(${lit(colours)}) do out[i] = C.oklch(v[1], v[2], v[3]) end return out end)()`);
add("color max_chroma", () => colours.map(([L, , h]) => C.maxChroma(L, h)), `(function() local out = {} for i, v in ipairs(${lit(colours)}) do out[i] = C.max_chroma(v[1], v[3]) end return out end)()`);
const rgbs: C.RGB[] = Array.from({ length: 30 }, () => [num(0, 1), num(0, 1), num(0, 1)]);
add("color lightness", () => rgbs.map(C.lightness), `(function() local out = {} for i, v in ipairs(${lit(rgbs)}) do out[i] = C.lightness(v) end return out end)()`);
add("color lch", () => rgbs.map(C.lch), `(function() local out = {} for i, v in ipairs(${lit(rgbs)}) do out[i] = {C.lch(v)} end return out end)()`);
add("color on_ground", () => rgbs.map((c) => C.onGround(c, C.DARK_GROUND, [1, 1, 1])), `(function() local out = {} for i, v in ipairs(${lit(rgbs)}) do out[i] = C.on_ground(v, C.DARK_GROUND, {1, 1, 1}) end return out end)()`);
for (const v of ["light", "dark", "#102030", "#A0B0C0", "#zz0000", "#10203", "red"]) {
  add(`color backdrop ${v}`, () => { const b = C.backdrop(v); return [b.ground ?? null, b.error ?? null]; }, `(function() local a, b = C.backdrop(${lit(v)}); return {a or NULL, b or NULL} end)()`);
}

// The occupancy grid, through one sequence of placements.
{
  const probes = points(25, 150).map(([x, y]): Pt => [x + 150, y + 100]);
  const line = walk(12).map(([x, y]): Pt => [x + 150, y + 100]);
  const tsRun = (): unknown[] => {
    const s = new Space(301, 199, 3);
    s.open(10, 10, 290, 190);
    s.blockText(100, 50, 200, 120);
    s.close(250, 150, 300, 199);
    const out: unknown[] = [probes.map(([x, y]) => [s.clearance(x, y, 40), s.clearance(x, y, 40, true), s.free(x, y), s.textAt(x, y), s.openAt(x, y)])];
    s.reserve(60, 60, 12, CORRIDOR);
    s.field();
    out.push(s.maxf, probes.map(([x, y]) => s.room(x, y)));
    s.disc(220, 60, 15, 0.8);
    s.box(30, 130, 70, 170);
    s.reserve(260, 40, 9);
    s.reserveLine(line, 3);
    s.reserveLine([[40, 40], [45, 42], [50, 45]], [2, 3, 4], CORRIDOR);
    out.push(probes.map(([x, y]) => [s.room(x, y), s.clearance(x, y, 30, true)]), s.freeCells(5), s.coverage());
    return out;
  };
  add("space placements", tsRun, `(function()
    local s = S.new(301, 199, 3)
    s:open(10, 10, 290, 190)
    s:block_text(100, 50, 200, 120)
    s:close(250, 150, 300, 199)
    local probes = ${lit(probes)}
    local a = {}
    for i, p in ipairs(probes) do a[i] = {s:clearance(p[1], p[2], 40), s:clearance(p[1], p[2], 40, true), s:free(p[1], p[2]) and true or false, s:text_at(p[1], p[2]), s:open_at(p[1], p[2])} end
    s:reserve(60, 60, 12, 4)
    s:field()
    local b = {}
    for i, p in ipairs(probes) do b[i] = s:room(p[1], p[2]) end
    s:disc(220, 60, 15, 0.8)
    s:box(30, 130, 70, 170)
    s:reserve(260, 40, 9)
    s:reserve_line(${lit(line)}, 3)
    s:reserve_line({{40, 40}, {45, 42}, {50, 45}}, {2, 3, 4}, 4)
    local c = {}
    for i, p in ipairs(probes) do c[i] = {s:room(p[1], p[2]), s:clearance(p[1], p[2], 30, true)} end
    return {a, s.maxf, b, c, s:free_cells(5), s:coverage()}
  end)()`);
}

// Petals of every kind, free and slotted, and the hero's tilt.
for (const kind of ["obovate", "lance", "round", "ghost", "fan", "wedge"]) {
  for (const [k, slotted] of [[0, false], [1, true]] as const) {
    const L = num(10, 60), Wd = L * num(0.3, 0.6), bend = num(-0.1, 0.1), wave = num(0.05, 0.2), seed = `petal ${kind} ${k}`;
    const sl = slotted ? F.slot(5, 0.08, 0.09) : undefined;
    add(`flower petal ${kind}${slotted ? " slotted" : ""}`, () => F.petal(new Rng(seed), kind, L, Wd, bend, slotted ? wave : undefined, sl),
      `F.petal(R.new(${lit(seed)}), ${lit(kind)}, ${lit(L)}, ${lit(Wd)}, ${lit(bend)}, ${slotted ? lit(wave) : "nil"}, ${slotted ? "F.slot(5, 0.08, 0.09)" : "nil"})`);
  }
}
add("flower slot", () => [F.slot(5, 0.08, 0.09), F.slot(6, 0, 0.1), F.slot(3, 0.2, 2)], "{F.slot(5, 0.08, 0.09), F.slot(6, 0, 0.1), F.slot(3, 0.2, 2)}");
{
  const probes = points(12, 80);
  for (const deg of [0, 35, 60]) {
    add(`flower tilt ${deg}`, () => { const [fn, rh] = F.tilt(10, -20, 45, deg); return [probes.map(([x, y]) => fn(x, y)), rh]; },
      `(function() local fn, rh = F.tilt(10, -20, 45, ${deg}); local out = {}; for i, p in ipairs(${lit(probes)}) do out[i] = {fn(p[1], p[2])} end; return {out, rh} end)()`);
  }
}

// Size curves and sprays.
for (const name of ["gyps", "leaf", "leaflet"]) {
  const xs = Array.from({ length: 23 }, (_, i) => -0.05 + i * 0.05);
  add(`dist spline ${name}`, () => { const f = D.spline(SIZES[name].points); return xs.map((x) => f(x)); },
    `(function() local f = D.spline(TU.sizes[${lit(name)}].points); local out = {}; for i, x in ipairs(${lit(xs)}) do out[i] = f(x) end; return out end)()`);
  add(`dist sample ${name}`, () => { const r = new Rng(name); return Array.from({ length: 40 }, () => D.sample(r, SIZES[name])); },
    `(function() local r = R.new(${lit(name)}); local out = {}; for i = 1, 40 do out[i] = D.sample(r, TU.sizes[${lit(name)}]) end; return out end)()`);
}
for (const [len, dir] of [[30, 1], [90, -1], [160, 1]] as const) {
  const p = point(50), a = num(0, 6);
  add(`sprig tendril ${len}`, () => SP.tendril(p, a, len, dir), `SP.tendril(${lit(p)}, ${lit(a)}, ${len}, ${dir})`);
  add(`sprig flourish ${len}`, () => SP.flourish(p, a, len, dir), `SP.flourish(${lit(p)}, ${lit(a)}, ${len}, ${dir})`);
}
// A batch as plain lists: hairlines by class, then florets, buds and stars.
const batchOf = (b: SP.Batch) => [b.ribbons, b.lines, b.florets.map((f) => [f.x, f.y, f.r, f.rot ?? 0, f.tint ?? 2, f.soft === true]), b.buds.map((d) => [d.x, d.y, d.ang, d.len]), b.stars.map((s) => [s.x, s.y, s.r])];
const BATCH_LUA = `local function plain(b) local fl = {}; for i, f in ipairs(b.florets) do fl[i] = {f[1], f[2], f[3], f[4] or 0, f[5] or 2, f[6] and true or false} end; return {b.ribbons, b.lines, fl, b.buds, b.stars} end`;
for (const seed of ["spray 1", "spray 2"]) {
  add(`sprig umbel ${seed}`, () => { const b = new SP.Batch(); SP.umbel(b, new Rng(seed), [10, 20], 1.4, 45); return batchOf(b); },
    `(function() ${BATCH_LUA}; local b = SP.batch(); SP.umbel(b, R.new(${lit(seed)}), {10, 20}, 1.4, 45); return plain(b) end)()`);
  add(`sprig cyme ${seed}`, () => { const b = new SP.Batch(); const axis = SP.cyme(b, new Rng(seed), [10, 20], 0.7, 55, -1); return [axis, batchOf(b)]; },
    `(function() ${BATCH_LUA}; local b = SP.batch(); local axis = SP.cyme(b, R.new(${lit(seed)}), {10, 20}, 0.7, 55, -1); return {axis, plain(b)} end)()`);
  add(`sprig gypsophila ${seed}`, () => { const b = new SP.Batch(); SP.gypsophila(b, new Rng(seed), [10, 20], 1.6, 32, 4); return batchOf(b); },
    `(function() ${BATCH_LUA}; local b = SP.batch(); SP.gypsophila(b, R.new(${lit(seed)}), {10, 20}, 1.6, 32, 4); return plain(b) end)()`);
  const stem = walk(30);
  add(`sprig leaflets ${seed}`, () => SP.leafletItems(new Rng(seed), stem, [12, 20], 14),
    `SP.leaflet_items(R.new(${lit(seed)}), ${lit(stem)}, {12, 20}, 14)`);
}

// Page planning: a body page with a short last paragraph, and a page whose
// text stops well short of the foot (an excursion).
{
  const lines = (n: number, top: number, last: number) => Array.from({ length: n }, (_, i) => ({ x0: 162, x1: i === n - 1 ? last : 436, y0: top - 12 * i, y1: top - 12 * i + 8 }));
  const pages = [
    { name: "body", spec: { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines: lines(48, 712, 300) } },
    { name: "short", spec: { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, lines: lines(20, 712, 380), edge: 14, gutter: 10 } },
    { name: "bare", spec: { width: 420, height: 595, text: { x0: 140, y0: 90, x1: 380, y1: 520 }, bare: true, gather: 60 } },
  ];
  const probes = points(60, 300).map(([x, y]) => [x + 300, y + 420] as Pt);
  const LUA_STEMS = `local function stems(out) local t = {}; for i, st in ipairs(out) do local ws = {}; for k = 0, 10 do ws[#ws + 1] = st.width(k / 10) end; t[i] = {st.pts, ws, st.kind or NULL, st.tip or NULL} end; return t end`;
  for (const { name, spec } of pages) {
    add(`layout region ${name}`, () => {
      const [g, m] = LA.region(spec);
      return [[m.x0, m.x1, m.y0, m.y1, m.foot], probes.map(([x, y]) => [g.free(x, y), g.textAt(x, y), g.openAt(x, y)])];
    }, `(function() local g, m = LA.region(${lit(spec)}); local out = {}; for i, p in ipairs(${lit(probes)}) do out[i] = {g:free(p[1], p[2]) and true or false, g:text_at(p[1], p[2]), g:open_at(p[1], p[2])} end; return {{m.x0, m.x1, m.y0, m.y1, m.foot}, out} end)()`);
    const mw = spec.text.x0 - (spec.gutter ?? 9) - (spec.edge ?? 16);
    const hero = [ (spec.edge ?? 16) + mw * 0.5, spec.height * 0.72, mw * 0.5 ] as const;
    const ys = Array.from({ length: 30 }, (_, i) => 40 + i * 20);
    for (const avoid of [undefined, [40, 300, 90, 370] as const]) {
      const tag = `${name}${avoid ? " avoid" : ""}`;
      add(`layout strands ${tag}`, () => {
        const [, m] = LA.region(spec);
        const [out, corner, gest] = LA.strands(new Rng(tag), m, hero, spec.width, undefined, avoid);
        const stems = out.map((st) => [st.pts, Array.from({ length: 11 }, (_, k) => st.width(k / 10)), st.kind ?? null, st.tip ?? null]);
        return [stems, corner, gest.bows.map((b) => [b.y, b.amp, b.h]), gest.quiet, ys.map((y) => [gest.bow(y), gest.density(60, y)])];
      }, `(function() ${LUA_STEMS}; local g, m = LA.region(${lit(spec)}); local out, corner, gest = LA.strands(R.new(${lit(tag)}), m, ${lit(hero)}, ${spec.width}, nil, ${avoid ? lit(avoid) : "nil"}); local bows = {}; for i, b in ipairs(gest.bows) do bows[i] = {b.y, b.amp, b.h} end; local d = {}; for i, y in ipairs(${lit(ys)}) do d[i] = {gest.bow(y), gest.density(60, y)} end; return {stems(out), corner, bows, gest.quiet, d} end)()`);
    }
    const root = [spec.width * 0.64, 26] as Pt;
    add(`layout runners ${name}`, () => { const [g, m] = LA.region(spec); return LA.runners(m, root, spec.width, spec.edge ?? 16, g).map((r) => [r.pts, r.width(0.5)]); },
      `(function() local g, m = LA.region(${lit(spec)}); local out = {}; for i, r in ipairs(LA.runners(nil, m, ${lit(root)}, ${spec.width}, ${spec.edge ?? 16}, g)) do out[i] = {r.pts, r.width(0.5)} end; return out end)()`);
    add(`layout excursion ${name}`, () => { const e = LA.excursion(new Rng(name), spec, root); return e === undefined ? null : [e.pts, e.width(0.25)]; },
      `(function() local e = LA.excursion(R.new(${lit(name)}), ${lit(spec)}, ${lit(root)}); if not e then return NULL end; return {e.pts, e.width(0.25)} end)()`);
  }
  add("layout cartouche", () => [LA.cartoucheSize(148), LA.cartoucheSize(40, 2), LA.cartoucheSize(300)], "{{LA.cartouche_size(148)}, {LA.cartouche_size(40, 2)}, {LA.cartouche_size(300)}}");
}

// Growth on a page's stems: leaves at the nodes, tips, holes and details,
// as compose runs them (without the ornaments' reservations).
{
  const lines = Array.from({ length: 48 }, (_, i) => ({ x0: 162, x1: i === 47 ? 300 : 436, y0: 712 - 12 * i, y1: 720 - 12 * i }));
  const spec = { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
  const hero = [84.5, 606, 68.5] as const;
  for (const [seed, mix] of [["grow 1", undefined], ["grow 2", { lily: 3, density: 0.7, leaves: 1.5, curls: 2 }]] as const) {
    add(`grow page ${seed}`, () => {
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
      GR.holes(g, r.fork("holes"), ctx);
      GR.details(g, r.fork("details"), ctx);
      const counts = ["bloom", "soft", "lily", "ghost", "umbel", "cyme", "gyps"].map((k) => ctx.counts[k] ?? 0);
      return [counts, ctx.leaves.map((l) => l.at), ctx.blooms.map((b) => b.at), ctx.back.map((b) => b.at), ctx.leaflets, batchOf(ctx.sprays), batchOf(ctx.stemBatch), strands.map((st) => Array.from({ length: 11 }, (_, k) => st.width(k / 10))), g.coverage()];
    }, `(function()
      ${BATCH_LUA}
      local spec = ${lit(spec)}
      local mix = ${mix ? lit(mix) : "nil"}
      local hero = ${lit(hero)}
      local g, m = LA.region(spec)
      g:field()
      local gest = LA.gesture(R.new(${lit(seed)}):fork("gesture"), m, hero)
      local strands = LA.strands(R.new(${lit(seed)}):fork("strands"), m, hero, 595, gest, {16, 300, 66, 370})
      for _, st in ipairs(strands) do g:reserve_line(st.pts, 2, 4) end
      local pos = {}
      local ctx = { cfg = MX.cfg(TU.compose, mix), mix = mix, pos = pos, mw = m.x1 - m.x0, dens = MX.density(gest.density, mix), ylo = m.y0, span = hero[2] - m.y0,
        strands = strands, stems = strands, stem_batch = SP.batch(), sprays = SP.batch(), blooms = {}, back = {}, leaves = {}, leaflets = {}, counts = {} }
      local r = R.new(${lit(seed)}):fork("grow")
      local res
      MX.with_mix(mix, function()
        GR.node_leaves(g, r:fork("nodes"), strands, ctx)
        GR.tips(g, r:fork("tips"), strands, ctx)
        GR.holes(g, r:fork("holes"), ctx)
        GR.details(g, r:fork("details"), ctx)
      end)
      local function at(list) local t = {}; for i, f in ipairs(list) do t[i] = pos[f] end; return t end
      local counts = {}
      for i, k in ipairs({"bloom", "soft", "lily", "ghost", "umbel", "cyme", "gyps"}) do counts[i] = ctx.counts[k] or 0 end
      local widths = {}
      for i, st in ipairs(strands) do local ws = {}; for k = 0, 10 do ws[#ws + 1] = st.width(k / 10) end; widths[i] = ws end
      return {counts, at(ctx.leaves), at(ctx.blooms), at(ctx.back), ctx.leaflets, plain(ctx.sprays), plain(ctx.stem_batch), widths, g:coverage()}
    end)()`);
  }
}
