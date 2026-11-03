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
