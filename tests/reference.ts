// The engine checked against tikz-flora's Lua generator, the code it was
// ported from: each case runs here and, as Lua, under texlua with
// tikz-flora's modules, and the answers must agree (exactly for the random
// streams, within a tolerance for floating-point geometry and colour).
//
//   node tests/reference.ts        (TIKZ_FLORA: the checkout, default
//                                    ../tikz-flora; TEXLUA: the interpreter)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASES, lit, type Case } from "./reference-cases.ts";
import "./reference-frames.ts";
import "./reference-growth.ts";

const ROOT = join(import.meta.dirname, "..");
const TIKZ = process.env.TIKZ_FLORA ?? join(ROOT, "..", "tikz-flora");
const TINY = join(process.env.HOME ?? "", "Library/TinyTeX/bin/universal-darwin/texlua");
const TEXLUA = process.env.TEXLUA ?? (existsSync(TINY) ? TINY : "texlua");

if (!existsSync(join(TIKZ, "lua/flora/rng.lua"))) {
  console.log(`reference: SKIPPED, no tikz-flora at ${TIKZ} (set TIKZ_FLORA)`);
  process.exit(0);
}

type Value = number | string | boolean | null | Value[] | { [k: string]: Value };

// Results as plain JSON values: undefined becomes null.
function plain(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : v > 0 ? "inf" : v < 0 ? "-inf" : "nan";
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(plain);
  return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)]));
}

const DRIVER = `
package.path = ${lit(join(TIKZ, "lua"))} .. "/?.lua;" .. package.path
R = require("flora.rng")
G = require("flora.geom")
C = require("flora.color")
S = require("flora.space")
F = require("flora.flower")
D = require("flora.dist")
SP = require("flora.sprig")
TU = require("flora.tune")
LA = require("flora.layout")
ORN = require("flora.ornaments")
O = require("flora.ornament")
FL = require("flora.flower")
LF = require("flora.leaf")
BR = require("flora.brush")
GR = require("flora.grow")
MX = require("flora.mix")
VI = require("flora.visitor")
CK = require("flora.clock")

-- A painter that records what it is given as the engine's Painter does
-- (tests/engine/scenes.ts numbers): every path's verbs and coordinates,
-- y turned over and circles as Bezier arcs, then each item's alpha and
-- colour, clips nested. Gilt is flat: gold paints as given.
PAINT = require("flora.paint")
function MOCK(H)
  local K, K2, SMALL = 0.5523, 1.3158, 2
  local function arcs(x, y, r)
    if r < SMALL then
      local h = r * K2
      return { { x + r, y + h, x - r, y + h, x - r, y }, { x - r, y - h, x + r, y - h, x + r, y } }
    end
    local k = r * K
    return { { x + r, y + k, x + k, y + r, x, y + r }, { x - k, y + r, x - r, y + k, x - r, y },
      { x - r, y - k, x - k, y - r, x, y - r }, { x + k, y - r, x + r, y - k, x + r, y } }
  end
  local pt = { out = {}, open = {}, alpha = 1, groups = {}, shadings = {}, _ramps = 0, metal = 0, flat_gilt = true, count = 0 }
  local function into()
    return #pt.open > 0 and pt.open[#pt.open] or pt.out
  end
  function pt:_pj()
    local pj, fr = self.projection, self.frame_fn
    if pj and fr then return function(x, y) return fr(pj(x, y)) end end
    return pj or fr
  end
  local function path(paths, nopj)
    local pj = not nopj and pt:_pj()
    local v = {}
    local function put(x, y)
      if pj then x, y = pj(x, y) end
      v[#v + 1] = x
      v[#v + 1] = H - y
    end
    local verbs, coords = {}, {}
    for _, cmds in ipairs(paths) do
      for _, c in ipairs(cmds) do
        local op = c[1]
        if op == "m" then verbs[#verbs + 1] = 0; put(c[2], c[3])
        elseif op == "l" then verbs[#verbs + 1] = 1; put(c[2], c[3])
        elseif op == "c" then verbs[#verbs + 1] = 2; put(c[2], c[3]); put(c[4], c[5]); put(c[6], c[7])
        elseif op == "z" then verbs[#verbs + 1] = 3
        elseif op == "o" then
          verbs[#verbs + 1] = 0; put(c[2] + c[4], c[3])
          for _, a in ipairs(arcs(c[2], c[3], c[4])) do verbs[#verbs + 1] = 2; put(a[1], a[2]); put(a[3], a[4]); put(a[5], a[6]) end
          verbs[#verbs + 1] = 3
        end
      end
    end
    return { verbs = verbs, coords = v }
  end
  function pt:ink(rgb) return rgb end
  function pt:fill(cmds, rgb, op, o)
    o = o or {}
    local t = into()
    t[#t + 1] = { kind = "fill", path = path(o.many and cmds or { cmds }), alpha = math.min(1, op or 1) * self.alpha, rgb = rgb }
  end
  function pt:stroke(cmds, rgb, w, op, o)
    o = o or {}
    local t = into()
    t[#t + 1] = { kind = "stroke", path = path(o.many and cmds or { cmds }), alpha = math.min(1, op or 1) * self.alpha, rgb = rgb, width = w }
  end
  function pt:shading(name, stops)
    if not self.shadings[name] then self.shadings[name] = stops end
    return name
  end
  function pt:shade(name, p0, p1, half)
    local pj = self:_pj()
    if pj then
      local a, b = pj(p0[1], p0[2]); local c, d = pj(p1[1], p1[2])
      p0, p1 = { a, b }, { c, d }
    end
    local dx, dy = p1[1] - p0[1], p1[2] - p0[2]
    local len = math.sqrt(dx * dx + dy * dy)
    if len < 0.01 then return end
    local ux, uy = dx / len, dy / len
    local nx, ny = -uy * half, ux * half
    local ext = len * 0.5
    local a = { p0[1] - ux * ext, p0[2] - uy * ext }
    local b = { p1[1] + ux * ext, p1[2] + uy * ext }
    local band = { { "m", a[1] + nx, a[2] + ny }, { "l", b[1] + nx, b[2] + ny }, { "l", b[1] - nx, b[2] - ny }, { "l", a[1] - nx, a[2] - ny }, { "z" } }
    local t = into()
    t[#t + 1] = { kind = "shade", path = path({ band }, true), alpha = self.alpha, from = { p0[1], H - p0[2] }, to = { p1[1], H - p1[2] }, stops = self.shadings[name] }
  end
  function pt:clip_begin(cmds)
    local c = { kind = "clip", path = path({ cmds }), items = {} }
    local t = into()
    t[#t + 1] = c
    self.open[#self.open + 1] = c.items
  end
  function pt:clip_end() self.open[#self.open] = nil end
  function pt:group_begin(op)
    self.groups[#self.groups + 1] = op
    self.alpha = self.alpha * op
  end
  function pt:group_end()
    self.groups[#self.groups] = nil
    local a = 1
    for _, g in ipairs(self.groups) do a = a * g end
    self.alpha = a
  end
  function pt:project(fn) self.projection = fn end
  function pt:frame(fn) self.frame_fn = fn end
  function pt:begin_group() end
  function pt:end_group() end
  -- Every number the recording holds, in painting order.
  function pt:numbers()
    local out = {}
    local function walk(items)
      for _, it in ipairs(items) do
        for _, v in ipairs(it.path.verbs) do out[#out + 1] = v end
        for _, v in ipairs(it.path.coords) do out[#out + 1] = v end
        if it.kind == "clip" then walk(it.items)
        else
          out[#out + 1] = it.alpha
          if it.kind == "stroke" then out[#out + 1] = it.width end
          if it.kind == "shade" then
            out[#out + 1] = it.from[1]; out[#out + 1] = it.from[2]; out[#out + 1] = it.to[1]; out[#out + 1] = it.to[2]
            for _, s in ipairs(it.stops) do out[#out + 1] = s[1]; out[#out + 1] = s[2][1]; out[#out + 1] = s[2][2]; out[#out + 1] = s[2][3] end
          else
            out[#out + 1] = it.rgb[1]; out[#out + 1] = it.rgb[2]; out[#out + 1] = it.rgb[3]
          end
        end
      end
    end
    walk(self.out)
    return out
  end
  return pt
end

NULL = setmetatable({}, { __tostring = function() return "null" end })
-- n draws of method m (with args) from stream r.
function draws(r, n, m, ...)
  local t = {}
  for i = 1, n do
    local v = r[m](r, ...)
    t[i] = v == nil and NULL or v
  end
  return t
end
local function ser(v)
  if v == nil or v == NULL then return "null" end
  local ty = type(v)
  if ty == "number" then
    if v ~= v then return '"nan"' end
    if v == math.huge then return '"inf"' end
    if v == -math.huge then return '"-inf"' end
    return string.format("%.17g", v)
  end
  if ty == "boolean" then return tostring(v) end
  if ty == "string" then return string.format("%q", v) end
  if ty == "table" then
    local n = #v
    local keys = {}
    for k in pairs(v) do if type(k) ~= "number" or k < 1 or k > n or k % 1 ~= 0 then keys[#keys + 1] = tostring(k) end end
    if #keys == 0 then
      local out = {}
      for i = 1, n do out[i] = ser(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    table.sort(keys)
    local out = {}
    for _, k in ipairs(keys) do out[#out + 1] = string.format("%q", k) .. ":" .. ser(v[k] ~= nil and v[k] or v[tonumber(k)]) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  error("cannot serialise a " .. ty)
end
`;

const script = DRIVER + CASES.map((c, i) => `
do
  local ok, r = pcall(function() return ${c.lua} end)
  io.write(${lit(String(i))}, "\\t", ok and ser(r) or string.format("%q", "ERROR " .. tostring(r)), "\\n")
end`).join("\n");

const dir = mkdtempSync(join(tmpdir(), "flora-reference-"));
const file = join(dir, "reference.lua");
writeFileSync(file, script);
const lines = execFileSync(TEXLUA, [file], { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n");
const lua = new Map(lines.map((l) => {
  const tab = l.indexOf("\t");
  return [Number(l.slice(0, tab)), JSON.parse(l.slice(tab + 1).replace(/\\\n/g, "\\n")) as Value];
}));

// Where `a` (ours) and `b` (Lua's) differ by more than `tol`, relative to
// the larger magnitude past 1; the worst numeric gap is kept in `worst`.
function diff(a: Value, b: Value, tol: number, at: string, worst: { gap: number }): string | undefined {
  if (typeof a === "number" && typeof b === "number") {
    const gap = Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
    worst.gap = Math.max(worst.gap, gap);
    return gap <= tol ? undefined : `${at}: ${a} vs Lua's ${b}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: ${a.length} items vs Lua's ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], tol, `${at}[${i}]`, worst);
      if (d) return d;
    }
    return undefined;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== null).sort(), kb = Object.keys(b).filter((k) => b[k] !== null).sort();
    if (ka.join() !== kb.join()) return `${at}: keys ${ka} vs Lua's ${kb}`;
    for (const k of ka) {
      const d = diff(a[k], b[k], tol, `${at}.${k}`, worst);
      if (d) return d;
    }
    return undefined;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? undefined : `${at}: ${JSON.stringify(a)?.slice(0, 120)} vs Lua's ${JSON.stringify(b)?.slice(0, 120)}`;
}

let failed = 0;
const groups = new Map<string, { n: number; worst: number }>();
CASES.forEach((c: Case, i) => {
  const worst = { gap: 0 };
  let ours: Value;
  try {
    ours = plain(c.ts());
  } catch (e) {
    ours = "ERROR " + (e as Error).message;
  }
  const theirs = lua.get(i);
  const d = theirs === undefined ? "no answer from Lua" : diff(ours, theirs, c.tol ?? 1e-12, c.name, worst);
  const g = c.name.split(" ")[0];
  const s = groups.get(g) ?? { n: 0, worst: 0 };
  s.n++;
  s.worst = Math.max(s.worst, worst.gap);
  groups.set(g, s);
  if (d) {
    failed++;
    if (failed <= 15) console.log(`FAIL ${d}`);
  }
});
for (const [g, s] of groups) console.log(`  ${g.padEnd(10)} ${String(s.n).padStart(4)} cases, largest relative gap ${s.worst.toExponential(1)}`);
console.log(failed ? `reference: ${failed} of ${CASES.length} cases differ from tikz-flora's Lua` : `reference: ${CASES.length} cases agree with tikz-flora's Lua`);
process.exit(failed ? 1 : 0);
