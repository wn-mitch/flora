// Prints the engine's answers to a fixed set of inputs, one labelled line
// each, so tests/agreement.ts can check that Node, texlua and LuaJIT give
// the same: `node tests/engine/dump.ts`, or its Lua bundles.
import { fmt, out } from "#platform";
import * as C from "../../src/engine/color.ts";
import * as G from "../../src/engine/geom.ts";
import { hash, Rng } from "../../src/engine/rng.ts";
import { CORRIDOR, Space } from "../../src/engine/space.ts";
import * as LA from "../../src/engine/layout.ts";
import * as CO from "../../src/engine/compose.ts";
import * as FR from "../../src/engine/frames.ts";
import * as ORN from "../../src/engine/ornaments.ts";
import { Painter } from "../../src/engine/paint.ts";
import type { Cmd, Pt } from "../../src/engine/geom.ts";
import { blooms, grow, growPage, numbers, sprays } from "./scenes.ts";

type Flat = number | boolean | string | readonly Flat[];

function flat(v: Flat, acc: string[]): void {
  if (typeof v === "number") acc.push(fmt(v, 12));
  else if (typeof v === "boolean") acc.push(v ? "T" : "F");
  else if (typeof v === "string") acc.push(v);
  else for (const x of v) flat(x, acc);
}

function line(label: string, v: Flat): void {
  const acc: string[] = [];
  flat(v, acc);
  out(label + " " + acc.join(" "));
}

const cmds = (cs: readonly Cmd[]): Flat => cs.map((c): Flat => c);

const gen = new Rng("agreement");
const walk = (n: number): Pt[] => {
  let x = gen.range(-50, 50), y = gen.range(-50, 50), a = gen.range(0, 6.28);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    a += gen.range(-0.6, 0.6);
    x += 6 * Math.cos(a);
    y += 6 * Math.sin(a);
    pts.push([x, y]);
  }
  return pts;
};
const blob = (n: number, r: number): Pt[] => {
  const cx = gen.range(-50, 50), cy = gen.range(-50, 50);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, rr = r * gen.range(0.5, 1.2);
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return pts;
};

for (const seed of [0, 1, 4294967295, -7, 2.9, "leaf", "é"]) {
  const r = new Rng(seed);
  const xs: number[] = [];
  for (let i = 0; i < 20; i++) xs.push(r.next());
  line("rng " + (typeof seed === "string" ? seed : fmt(seed, 1)), xs);
}
line("hash", [hash(""), hash("leaf"), hash("é🌼")]);
{
  const r = new Rng(5);
  const v: Flat[] = [];
  for (let i = 0; i < 20; i++) v.push(r.int(-3, 7), r.jit(0.3), r.chance(0.4), r.normal(1, 2), r.pick(["a", "b", "c"]), r.weighted({ gyps: 3, bud: 2, cyme: 1 }) ?? "none");
  const f = r.fork("leaf3");
  v.push(f.seed, f.next(), r.clone().next(), r.next());
  line("rng methods", v);
}

for (let k = 0; k < 4; k++) {
  const poly = blob(6 + 5 * k, 60), path = walk(5 + 6 * k);
  line(`smooth ${fmt(k, 0)}`, [cmds(G.smooth(poly, true, 0.8)), cmds(G.smooth(path, false)), cmds(G.polyline(path, true))]);
  line(`spline ${fmt(k, 0)}`, [G.splinePoints(path, 4), G.length(path), G.resample(path, 9)]);
  const ats: Flat[] = [];
  for (const t of [-0.2, 0, 0.5, 1, 1.3]) {
    const [p, a] = G.at(path, t);
    ats.push(p, a);
  }
  line(`at ${fmt(k, 0)}`, ats);
  line(`ribbon ${fmt(k, 0)}`, [G.ribbon(path, (t) => 1 + t), G.deform(poly, new Rng(k), 2)]);
  line(`area ${fmt(k, 0)}`, [G.area(poly), G.centroid(poly), G.bbox(poly), G.inside(poly, 0, 0), G.inside(poly, 30, -20)]);
  const s = G.spanSampler(poly, 2)!, r = new Rng(10 + k);
  const samples: Flat[] = [];
  for (let i = 0; i < 20; i++) samples.push(s(r) ?? "none");
  line(`sampler ${fmt(k, 0)}`, samples);
  const n = G.noise(new Rng(20 + k), 9), f = G.fbm(new Rng(30 + k), 16);
  const nv: Flat[] = [];
  for (const x of [-3.7, 0, 0.25, 7.9, 64, 130.2]) nv.push(n(x), f(x));
  line(`noise ${fmt(k, 0)}`, nv);
  const p = path[0], q = path[path.length - 1];
  const [fl, fa] = G.flow(p, 0.3, 80, (t) => 0.02 + 0.05 * t * t);
  line(`curves ${fmt(k, 0)}`, [G.curve(p, 0.4, 60, 0.7, 0.5), fl, fa, G.link(p, 0.2, q, 1.9), G.turn(5, -2), G.depart(p, 0.3, q)]);
  const fol = G.follow(path, 12);
  const [pp, pa] = G.pursue(p, 1, (x) => fol(x), { len: 120 });
  line(`pursue ${fmt(k, 0)}`, [pp, pa]);
}

{
  const v: Flat[] = [];
  for (let i = 0; i < 30; i++) {
    const L = gen.range(0.05, 0.98), ch = gen.range(0, 0.3), h = gen.range(0, 360);
    const rgb = C.oklch(L, ch, h);
    v.push(rgb, C.maxChroma(L, h), C.lightness(rgb), C.lch(rgb), C.onGround(rgb, C.DARK_GROUND, [1, 1, 1]));
  }
  for (const b of ["light", "dark", "#102030", "#A0B0C0", "#zz0000"]) {
    const r = C.backdrop(b);
    v.push(r.ground ?? "none", r.error ?? "none");
  }
  line("color", v);
}

{
  const s = new Space(301, 199, 3);
  s.open(10, 10, 290, 190);
  s.blockText(100, 50, 200, 120);
  s.close(250, 150, 300, 199);
  const probes: Pt[] = [];
  for (let i = 0; i < 20; i++) probes.push([gen.range(0, 300), gen.range(0, 200)]);
  const v: Flat[] = [];
  for (const [x, y] of probes) v.push(s.clearance(x, y, 40), s.clearance(x, y, 40, true), s.free(x, y), s.textAt(x, y), s.openAt(x, y));
  s.reserve(60, 60, 12, CORRIDOR);
  s.field();
  for (const [x, y] of probes) v.push(s.room(x, y));
  s.disc(220, 60, 15, 0.8);
  s.box(30, 130, 70, 170);
  s.reserveLine(walk(12), 3);
  for (const [x, y] of probes) v.push(s.room(x, y));
  v.push(s.freeCells(6), s.coverage(), s.maxf);
  line("space", v);
}

// Whole leaves with their washes, a few numbers to a line so a difference
// is easy to place.
for (const [seed, len, ang] of [["agree 1", 110, 1.3], ["agree 2", 40, 2.2], ["agree 3", 150, 0.6]] as const) {
  const v = numbers(grow(seed, len, ang).items);
  line(`leaf ${seed} count`, [v.length]);
  for (let i = 0; i < v.length; i += 64) line(`leaf ${seed} ${fmt(i, 0)}`, v.slice(i, i + 64));
}

for (const [seed, style] of [["agree 1", "wedge"], ["agree 2", "fan"], ["agree 3", "soft"]] as const) {
  const v = numbers(blooms(seed, style).items);
  line(`blooms ${seed} count`, [v.length]);
  for (let i = 0; i < v.length; i += 64) line(`blooms ${seed} ${fmt(i, 0)}`, v.slice(i, i + 64));
}

for (const seed of ["agree 1", "agree 2"]) {
  const v = numbers(sprays(seed).items);
  line(`sprays ${seed} count`, [v.length]);
  for (let i = 0; i < v.length; i += 64) line(`sprays ${seed} ${fmt(i, 0)}`, v.slice(i, i + 64));
}

// A page's stems: every point and width of each, a stem to a line.
{
  const lines: LA.Box[] = [];
  for (let i = 0; i < 40; i++) lines.push({ x0: 162, x1: i === 39 ? 300 : 436, y0: 712 - 12 * i, y1: 720 - 12 * i });
  const spec: LA.PageSpec = { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, lines };
  const [g, m] = LA.region(spec);
  line("layout coverage", [g.coverage(), g.freeCells(9).length]);
  const [stems, corner] = LA.strands(new Rng("agree"), m, [84.5, 606, 68.5], 595, undefined, [40, 300, 90, 370]);
  line("layout corner", corner);
  for (let i = 0; i < stems.length; i++) {
    const st = stems[i];
    const ws: number[] = [];
    for (let k = 0; k <= 10; k++) ws.push(st.width(k / 10));
    line(`layout stem ${fmt(i, 0)}`, [st.kind ?? "main", st.pts, ws]);
  }
}

// A page's growth: what was placed where.
for (const { seed, mix } of [{ seed: "agree 1" }, { seed: "agree 2", mix: { lily: 3, density: 0.7 } }]) {
  const [g, ctx] = growPage(seed, mix);
  line(`grow ${seed} counts`, ["bloom", "soft", "lily", "ghost", "umbel", "cyme", "gyps"].map((k) => ctx.counts[k] ?? 0));
  line(`grow ${seed} leaves`, ctx.leaves.map((l) => l.at));
  line(`grow ${seed} blooms`, [ctx.blooms.map((b) => b.at), ctx.back.map((b) => b.at)]);
  line(`grow ${seed} leaflets`, ctx.leaflets);
  line(`grow ${seed} florets`, ctx.sprays.florets.map((f) => [f.x, f.y, f.r]));
  line(`grow ${seed} coverage`, [g.coverage()]);
}

// Every ornament kind, gilt in relief, a corner mirrored: every number
// painted.
for (const k of ORN.SLOT_ORDER.flatMap((slot) => ORN.of(slot))) {
  const pt = new Painter({ width: 300, height: 300 });
  const box: ORN.Box = k.slot === "corner" ? [100, 100, 172, 172] : k.slot === "flourish" ? [20, 120, 280, 166] : [100, 100, 160, 180];
  ORN.draw(k, pt, new Rng(k.name), box, k.slot === "corner" ? { flip: [-1, 1] } : {});
  line(`ornament ${k.name}`, numbers(pt.scene().items));
}

// Every layout of a title page: where each frame's projections send probe
// points, and what the layout paints round the plants.
{
  const lines: LA.Box[] = [];
  for (let i = 0; i < 3; i++) lines.push({ x0: 200, x1: 398, y0: 690 - 30 * i, y1: 710 - 30 * i });
  for (let i = 0; i < 26; i++) lines.push({ x0: 162, x1: 436, y0: 520 - 14 * i, y1: 529 - 14 * i });
  for (const layout of FR.ORDER) {
    const fs = FR.of({ width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, seed: 7, lines, layout });
    for (let i = 0; i < fs.frames.length; i++) {
      const f = fs.frames[i];
      const t = f.spec.text;
      const fn = f.fn, inv = f.inv;
      line(`frames ${layout} ${fmt(i, 0)}`, [f.spec.width, f.spec.height, t.x0, t.y0, t.x1, t.y1,
        fn === undefined ? [] : [fn(0, 0), fn(40, 120), fn(150, 400)], inv === undefined ? [] : [inv(60, 300), inv(297, 600)]]);
    }
    const pt = new Painter({ width: 595, height: 842 });
    fs.before?.(pt);
    fs.after?.(pt);
    line(`frames ${layout} paint`, numbers(pt.scene().items));
  }
}

// Whole pages, as the sums of blocks of 512 painted numbers (a page paints
// millions): a body page, part grown, and two of the framed layouts.
{
  const lines: LA.Box[] = [];
  for (let i = 0; i < 40; i++) lines.push({ x0: 162, x1: i === 39 ? 300 : 436, y0: 712 - 12 * i, y1: 720 - 12 * i });
  const base: FR.FloraSpec = { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, seed: 2, lines };
  const specs: [string, FR.FloraSpec][] = [["left", base], ["grow", { ...base, grow: 0.5 }], ["flank", { ...base, layout: "flank" }], ["scrollwork", { ...base, layout: "scrollwork" }]];
  for (const [name, spec] of specs) {
    const p = CO.page(spec);
    const nums = numbers(p.pt.scene().items);
    const sums: number[] = [];
    for (let i = 0; i < nums.length; i += 512) {
      let s = 0;
      for (let j = i; j < Math.min(nums.length, i + 512); j++) s += nums[j];
      sums.push(s);
    }
    line(`page ${name}`, [nums.length, p.coverage, sums]);
  }
}
