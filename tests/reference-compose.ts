// Reference cases for whole pages (tests/reference.ts): compose.ts plans
// and paints a page in every layout, with a mix, a palette and part grown,
// and every number painted (summed in blocks), the coverage and the motif counts must match
// tikz-flora's compose.lua painting onto the recording painter. The Lua
// strokes washed leaflets' midribs as a list of paths without saying so,
// which paints nothing (tikz-flora TASK-40); here the recording painter
// strokes them as the engine does (LIST_STROKES).
import * as CO from "../src/engine/compose.ts";
import type { FloraSpec } from "../src/engine/frames.ts";
import type { Box } from "../src/engine/layout.ts";
import { numbers } from "./engine/scenes.ts";
import { add, lit } from "./reference-cases.ts";

const lines = (n: number, top: number, step: number, x0: number, x1: number, h: number): Box[] =>
  Array.from({ length: n }, (_, i) => ({ x0, x1, y0: top - step * i, y1: top - step * i + h }));
const BODY: FloraSpec = {
  width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, seed: 2,
  lines: [...lines(39, 712, 12, 162, 436, 8), { x0: 162, x1: 300, y0: 244, y1: 252 }],
};
const TITLE: FloraSpec = {
  width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, seed: 7,
  lines: [...lines(3, 690, 30, 200, 398, 20), ...lines(26, 520, 14, 162, 436, 9)],
};
const PAGES: [string, FloraSpec][] = [
  ["body", BODY],
  ["body short", { ...BODY, seed: 5, lines: lines(12, 712, 12, 162, 436, 8) }],
  ["body mix", { ...BODY, seed: 9, mix: { lily: 3, umbel: 0, density: 0.7, bee: 2, butterfly: 2, snail: 1, bird: 1 }, ornaments: { compass: 0 } }],
  ["body palette", { ...BODY, seed: 4, palette: { blooms: "random", leaves: "random" }, spin: 2 }],
  ["body grow", { ...BODY, seed: 3, grow: 0.5 }],
  // A plant hung down a long web margin, with its growth budgeted.
  ["margin budget", {
    width: 146, height: 3000, seed: 7, budget: 3,
    text: { x0: 116, y0: 24, x1: 146, y1: 2976 }, lines: [{ x0: 116, y0: 24, x1: 146, y1: 2976 }],
  }],
  ...["right", "centered", "split", "title", "surround", "flank", "wreath", "bouquet", "scrollwork"].map((layout): [string, FloraSpec] => [layout, { ...TITLE, layout }]),
];

// A page paints millions of numbers, too many to pass whole, so each side
// sends the sums of consecutive blocks of B (in painting order, summed the
// same way) and how many there are: a block that differs still names where.
const B = 32;
function blocks(nums: readonly number[]): number[] {
  const out = [nums.length];
  for (let i = 0; i < nums.length; i += B) {
    let s = 0;
    for (let j = i; j < Math.min(nums.length, i + B); j++) s += nums[j];
    out.push(s);
  }
  return out;
}
const LUA_BLOCKS = `local function blocks(nums)
      local out = {#nums}
      for i = 1, #nums, ${B} do
        local s = 0
        for j = i, math.min(#nums, i + ${B} - 1) do s = s + nums[j] end
        out[#out + 1] = s
      end
      return out
    end`;

for (const [name, spec] of PAGES) {
  const H = spec.height;
  add(`compose page ${name}`, () => {
    const pt = CO.painterFor(spec);
    pt.flatGilt = true;
    const p = CO.page(spec, { painter: pt });
    return [blocks(numbers(pt.scene().items)), p.coverage, p.planted[p.planted.length - 1].counts];
  }, `(function()
    local CO = require("flora.compose")
    ${LUA_BLOCKS}
    local new = PAINT.new
    PAINT.new = function() return MOCK(${H}) end
    LIST_STROKES = true
    local ok, pt = pcall(CO.page, ${lit(spec)})
    PAINT.new = new
    LIST_STROKES = nil
    if not ok then error(pt) end
    return {blocks(pt:numbers()), pt.coverage, pt.counts} end)()`, 1e-9);
}

// The page's progress (o.progress; compose.lua's spec.progress): the same
// rising list of values, ending in 1, sent at the same points.
for (const [name, spec] of PAGES) {
  const H = spec.height;
  add(`compose progress ${name}`, () => {
    const pt = CO.painterFor(spec);
    pt.flatGilt = true;
    const sent: number[] = [];
    CO.page(spec, { painter: pt, progress: (f) => sent.push(f) });
    return sent;
  }, `(function()
    local CO = require("flora.compose")
    local new = PAINT.new
    PAINT.new = function() return MOCK(${H}) end
    local spec = ${lit(spec)}
    local sent = {}
    spec.progress = function(f) sent[#sent + 1] = f end
    local ok, err = pcall(CO.page, spec)
    PAINT.new = new
    if not ok then error(err) end
    return sent end)()`, 1e-9);
}
