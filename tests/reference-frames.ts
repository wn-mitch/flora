// Reference cases for a page's frames (tests/reference.ts): the oval the
// curved layouts lay plants along, the title furniture and its ribbons,
// the scrollwork frame, and every layout's frames, each checked against
// tikz-flora's Lua.
import * as FR from "../src/engine/frames.ts";
import type { Frame, FloraSpec } from "../src/engine/frames.ts";
import type { Pt } from "../src/engine/geom.ts";
import * as RB from "../src/engine/orn_ribbon.ts";
import * as SW from "../src/engine/orn_scrollwork.ts";
import * as TI from "../src/engine/orn_title.ts";
import { Oval } from "../src/engine/oval.ts";
import type { Box } from "../src/engine/layout.ts";
import { add, lit, scene } from "./reference-cases.ts";

const LUA = `local FR = require("flora.frames"); local OV = require("flora.oval"); local TI = require("flora.orn_title"); local RB = require("flora.orn_ribbon"); local SW = require("flora.orn_scrollwork")`;

// The oval: arclength and angle both ways, points and normals, the nearest
// angle to points inside, outside and on it, and its maps there and back,
// plain and mirrored.
{
  const ov = new Oval(300, 420, 210, 300);
  const ss = [-50, 0, 1, 123.4, ov.len / 2, ov.len - 0.5, ov.len + 80];
  const probes: Pt[] = [[300, 420], [90, 420], [520, 600], [300, 900], [310, 130]];
  const uv: Pt[] = [[0, 0], [12, 40], [-30, 300], [80, -20]];
  add("layout oval", () => {
    const [fn, inv] = ov.maps(-26, 60);
    const [mfn, minv] = ov.maps(30, 60, true);
    return [ov.len,
      ss.map((s) => { const th = ov.theta(s); return [th, ov.arclength(th), ov.point(th)]; }),
      probes.map((p) => ov.nearest(p[0], p[1])),
      uv.map((p) => [fn(p[0], p[1]), inv(...fn(p[0], p[1])), mfn(p[0], p[1]), minv(...mfn(p[0], p[1]))])];
  }, `(function() ${LUA}; local ov = OV.new(300, 420, 210, 300)
    local out2 = {}; for i, s in ipairs(${lit(ss)}) do local th = ov:theta(s); out2[i] = {th, ov:arclength(th), {ov:point(th)}} end
    local out3 = {}; for i, p in ipairs(${lit(probes)}) do out3[i] = ov:nearest(p[1], p[2]) end
    local fn, inv = ov:maps(-26, 60); local mfn, minv = ov:maps(30, 60, true)
    local out4 = {}; for i, p in ipairs(${lit(uv)}) do out4[i] = {{fn(p[1], p[2])}, {inv(fn(p[1], p[2]))}, {mfn(p[1], p[2])}, {minv(mfn(p[1], p[2]))}} end
    return {ov.len, out2, out3, out4} end)()`);
}

// A title page: a three-line title, a gap, then body text, and a running
// head. Its lines are those a typeset page reports.
const lines = (n: number, top: number, step: number, x0: number, x1: number, h: number): Box[] =>
  Array.from({ length: n }, (_, i) => ({ x0, x1, y0: top - step * i, y1: top - step * i + h }));
const TITLE: FloraSpec = {
  width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, seed: 7,
  lines: [...lines(3, 690, 30, 200, 398, 20), ...lines(26, 520, 14, 162, 436, 9)],
};
const SPECS: [string, FloraSpec][] = [
  ["title", TITLE],
  ["plain", { width: 420, height: 595, text: { x0: 140, y0: 90, x1: 380, y1: 520 }, seed: "pressed" }],
  ["page2", { ...TITLE, page: 2, seed: 3, mix: { density: 1.4 } }],
];

// The title's furniture: the crest's size, the pieces and the boxes they
// keep, and a crest at the foot of a page.
for (const [name, spec] of SPECS) {
  const B = FR.topBlock(spec);
  const pieces = (ps: readonly TI.Piece[]) => ps.map((p) => [p.slot, p.kind.name, p.box, p.o.flip ?? null, p.o.cord ?? null]);
  add(`layout title ${name}`, () => {
    const c = TI.crestSize(spec, 40);
    const [ps, keep] = TI.plan(spec, B, c);
    const f = TI.foot(spec, B);
    return [B, c, pieces(ps), keep, f === undefined ? null : pieces([f])];
  }, `(function() ${LUA}; local spec = ${lit(spec)}; local B = FR.top_block(spec); local c = TI.crest_size(spec, 40)
    local function pieces(ps) local out = {}; for i, p in ipairs(ps) do out[i] = {p.slot, p.kind.name, p.box, p.o.flip or NULL, p.o.cord or NULL} end; return out end
    local ps, keep = TI.plan(spec, B, c); local f = TI.foot(spec, B)
    return {B, c, pieces(ps), keep, f and pieces({f}) or NULL} end)()`);
  scene(`paint title ${name}`, (pt) => TI.paint(pt, spec, TI.plan(spec, B, TI.crestSize(spec, 40))[0]),
    `${LUA}; local spec = ${lit(spec)}; local B = FR.top_block(spec); TI.paint(pt, spec, (TI.plan(spec, B, TI.crest_size(spec, 40))))`);
}

// Ribbons behind lines, tails down and up, and the bow that ties a
// bouquet.
{
  const ls: Box[] = [{ x0: 40, y0: 100, x1: 220, y1: 122 }, { x0: 60, y0: 60, x1: 150, y1: 70 }];
  add("layout ribbon", () => ls.flatMap((l) => [-1, 1].map((d) => RB.shape(l, d))),
    `(function() ${LUA}; local out = {}; for _, l in ipairs(${lit(ls)}) do for _, d in ipairs({-1, 1}) do out[#out + 1] = RB.shape(l, d) end end; return out end)()`);
  scene("paint ribbon", (pt) => RB.paint(pt, ls), `${LUA}; RB.paint(pt, ${lit(ls)})`);
  scene("paint bow", (pt) => { RB.bow(pt, 100, 100, 30); RB.bow(pt, 200, 60, 12); }, `${LUA}; RB.bow(pt, 100, 100, 30); RB.bow(pt, 200, 60, 12)`);
}

// Every layout's frames: each frame's page (the fields the plants read),
// its map, and where its projections send probe points.
const PROBES: Pt[] = [[0, 0], [40, 120], [150, 400], [-20, 30]];
const PAGE_PROBES: Pt[] = [[60, 300], [297, 600], [500, 100]];
const KEYS = ["width", "height", "text", "lines", "closed", "frame_only", "bare", "header_y", "seed", "mix"] as const;
const frameOf = (f: Frame) => [
  Object.fromEntries(KEYS.map((k) => [k, f.spec[k] ?? null])),
  f.map ?? null, f.label ?? null,
  f.fn === undefined ? null : PROBES.map((p) => f.fn!(p[0], p[1])),
  f.inv === undefined ? null : PAGE_PROBES.map((p) => f.inv!(p[0], p[1])),
];
const LUA_FRAME = `local KEYS = ${lit([...KEYS])}
    local function frame(f)
      local s = {}; for _, k in ipairs(KEYS) do s[k] = f.spec[k] end
      local a, b = NULL, NULL
      if f.fn then a = {}; for i, p in ipairs(${lit(PROBES)}) do a[i] = {f.fn(p[1], p[2])} end end
      if f.inv then b = {}; for i, p in ipairs(${lit(PAGE_PROBES)}) do b[i] = {f.inv(p[1], p[2])} end end
      return {s, f.map or NULL, f.label or NULL, a, b}
    end`;
for (const [name, base] of SPECS) {
  for (const layout of FR.ORDER) {
    const spec: FloraSpec = { ...base, layout };
    add(`layout frames ${layout} ${name}`, () => {
      const fs = FR.of(spec);
      const ov = fs.oval;
      return [fs.frames.map(frameOf), (fs.title ?? []).map((p) => [p.slot, p.kind.name, p.box, p.o.flip ?? null, p.o.cord ?? null]),
        ov === undefined ? null : [ov.cx, ov.cy, ov.a, ov.b], fs.tie ?? null,
        fs.scrollwork === undefined ? null : [fs.scrollwork.w, fs.scrollwork.crest?.name ?? null, fs.scrollwork.tail?.name ?? null, fs.scrollwork.head, fs.scrollwork.foot]];
    }, `(function() ${LUA}; ${LUA_FRAME}
      local fs = FR.of(${lit(spec)}); local out = {}; for i, f in ipairs(fs) do out[i] = frame(f) end
      local title = {}; for i, p in ipairs(fs.title or {}) do title[i] = {p.slot, p.kind.name, p.box, p.o.flip or NULL, p.o.cord or NULL} end
      local ov = fs.oval and {fs.oval.cx, fs.oval.cy, fs.oval.a, fs.oval.b} or NULL
      local sw = fs.scrollwork and {fs.scrollwork.w, fs.scrollwork.crest and fs.scrollwork.crest.name or NULL, fs.scrollwork.tail and fs.scrollwork.tail.name or NULL, fs.scrollwork.head, fs.scrollwork.foot} or NULL
      return {out, title, ov, fs.tie or NULL, sw} end)()`, 1e-9);
  }
  // What the layouts paint round their plants.
  for (const layout of ["bouquet", "scrollwork"]) {
    const spec: FloraSpec = { ...base, layout };
    for (const when of ["before", "after"] as const) {
      scene(`paint frames ${layout} ${when} ${name}`, (pt) => FR.of(spec)[when]?.(pt),
        `${LUA}; local fs = FR.of(${lit(spec)}); if fs.${when} then fs.${when}(pt) end`);
    }
  }
}

// The scrollwork frame on an oval of its own, without a layout's plants.
{
  const ov = new Oval(150, 150, 110, 130);
  const spec: TI.TitleSpec = { width: 300, height: 300, text: { x0: 60, y0: 40, x1: 240, y1: 260 }, seed: 11 };
  scene("paint scrollwork", (pt) => { const p = SW.plan(spec, ov); SW.under(pt, spec, ov, p); SW.over(pt, spec, ov, p); },
    `${LUA}; local ov = OV.new(150, 150, 110, 130); local spec = ${lit(spec)}; local p = SW.plan(spec, ov); SW.under(pt, spec, ov, p); SW.over(pt, spec, ov, p)`);
}
