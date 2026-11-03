// The painter on every target: y turned over, circles as Bezier arcs, clips
// nested and balanced, ink repainted for a dark backdrop.
import { mod } from "#platform";
import { DARK_GROUND, lightness } from "../../src/engine/color.ts";
import type { Cmd } from "../../src/engine/geom.ts";
import { PAL, Painter, CUBIC, MOVE, CLOSE, type SceneItem } from "../../src/engine/paint.ts";
import { check, eq, eqList, near, test, throws } from "./harness.ts";

const kinds = (items: readonly SceneItem[]) => items.map((it) => it.kind);

test("paint turns y over to run down from the top", () => {
  const pt = new Painter({ width: 100, height: 50 });
  pt.fill([["m", 1, 2], ["l", 3, 40], ["c", 1, 1, 2, 2, 3, 3], ["z"]], PAL.blue, 0.5);
  const it = pt.scene().items[0];
  check(it.kind === "fill", "a fill");
  if (it.kind !== "fill") return;
  eqList(it.path.verbs, [0, 1, 2, 3], "verbs");
  eqList(it.path.coords, [1, 48, 3, 10, 1, 49, 2, 48, 3, 47], "coords");
  eq(it.alpha, 0.5, "alpha");
  eq(it.blend, "normal", "blend");
  eq(it.rule, "nonzero", "rule");
});

test("circles become four arcs, or two under 2 pt", () => {
  const pt = new Painter({ width: 10, height: 10 });
  pt.fill([["o", 5, 5, 3]], PAL.blue);
  pt.fill([["o", 5, 5, 1]], PAL.blue);
  const [big, small] = pt.scene().items;
  if (big.kind !== "fill" || small.kind !== "fill") throw new Error("two fills");
  eqList(big.path.verbs, [MOVE, CUBIC, CUBIC, CUBIC, CUBIC, CLOSE], "big verbs");
  eqList(small.path.verbs, [MOVE, CUBIC, CUBIC, CLOSE], "small verbs");
  // Every arc ends on the circle: (x - 5)^2 + (y - 5)^2 = r^2.
  for (const [it, r] of [[big, 3], [small, 1]] as const) {
    const c = it.path.coords;
    for (let k = 0; k + 1 < c.length; k += 2) {
      if (k === 0 || mod(k - 2, 6) === 4) near(Math.sqrt((c[k] - 5) ** 2 + (c[k + 1] - 5) ** 2), r, 1e-12, "end point on the circle");
    }
  }
});

test("clips nest, and an open or unmatched clip throws", () => {
  const pt = new Painter({ width: 10, height: 10 });
  pt.clipBegin([["m", 0, 0], ["l", 5, 0], ["l", 5, 5], ["z"]]);
  pt.fill([["m", 1, 1], ["l", 2, 2]], PAL.blue);
  pt.clipBegin([["m", 0, 0], ["l", 3, 3]]);
  pt.stroke([["m", 1, 1], ["l", 2, 2]], PAL.ink, 1);
  pt.clipEnd();
  pt.fill([["m", 1, 1], ["l", 2, 2]], PAL.blue);
  throws(() => pt.scene(), "still open", "an open clip");
  pt.clipEnd();
  pt.fill([["m", 1, 1], ["l", 2, 2]], PAL.white);
  const items = pt.scene().items;
  eqList(kinds(items).map((k) => (k === "clip" ? 1 : 0)), [1, 0], "top level: a clip, then a fill");
  const outer = items[0];
  if (outer.kind !== "clip") throw new Error("a clip");
  eqList(kinds(outer.items).map((k) => (k === "clip" ? 1 : k === "fill" ? 0 : 2)), [0, 1, 0], "inside: fill, clip, fill");
  const inner = outer.items[1];
  if (inner.kind !== "clip") throw new Error("an inner clip");
  eq(inner.items.length, 1, "the stroke is inside the inner clip");
  eq(pt.count, 4, "painted items");
  throws(() => pt.clipEnd(), "without clipBegin", "an unmatched clipEnd");
});

test("a dark backdrop turns ink over, swaps multiply and screen, keeps white and gold", () => {
  const pt = new Painter({ width: 10, height: 10, backdrop: DARK_GROUND });
  const sq = (): Cmd[] => [["m", 0, 0], ["l", 1, 0], ["l", 1, 1], ["z"]];
  pt.fill(sq(), PAL.deep, 1, { blend: "multiply" });
  pt.fill(sq(), PAL.white, 1, { blend: "screen" });
  pt.fill(sq(), PAL.gold);
  const [deep, white, gold] = pt.scene().items;
  if (deep.kind !== "fill" || white.kind !== "fill" || gold.kind !== "fill") throw new Error("fills");
  if (deep.paint.kind !== "solid" || white.paint.kind !== "solid" || gold.paint.kind !== "solid") throw new Error("solid");
  eq(deep.blend, "screen", "multiply becomes screen");
  eq(white.blend, "multiply", "screen becomes multiply");
  eq(gold.blend, "normal", "normal stays");
  check(lightness(deep.paint.rgb) > lightness(DARK_GROUND) + 0.4, "pooled ultramarine glows on the dark ground");
  check(white.paint.rgb === PAL.white, "white is kept");
  check(gold.paint.rgb === PAL.gold, "gold is kept");
  const paper = new Painter({ width: 10, height: 10 });
  paper.fill(sq(), PAL.deep, 1, { blend: "multiply" });
  const p = paper.scene().items[0];
  if (p.kind !== "fill" || p.paint.kind !== "solid") throw new Error("a solid fill");
  check(p.paint.rgb === PAL.deep, "on paper ink is itself");
  eq(p.blend, "multiply", "on paper multiply stays");
});

test("shading lays a linear gradient along its axis, turned over", () => {
  const pt = new Painter({ width: 10, height: 100 });
  pt.shade([[0, PAL.white], [1, PAL.deep]], [0, 10], [0, 30], 5);
  pt.shade([[0, PAL.white]], [1, 1], [1, 1.001], 5);
  const items = pt.scene().items;
  eq(items.length, 1, "a degenerate axis paints nothing");
  const it = items[0];
  if (it.kind !== "fill" || it.paint.kind !== "linear") throw new Error("a linear fill");
  eqList(it.paint.from, [0, 90], "from");
  eqList(it.paint.to, [0, 70], "to");
  // The band runs half the axis beyond each end: y 0 to 40, turned over.
  eqList(it.path.coords, [-5, 100, -5, 60, 5, 60, 5, 100], "band");
});

test("a projection moves every path and shading once, and clears", () => {
  const pt = new Painter({ width: 100, height: 100 });
  pt.project((x, y) => [2 * x, y + 10]);
  pt.fill([["m", 1, 2], ["c", 1, 1, 2, 2, 3, 3]], PAL.blue);
  pt.fill([["o", 5, 5, 3]], PAL.blue);
  pt.shade([[0, PAL.white], [1, PAL.deep]], [0, 10], [0, 30], 5);
  pt.project(undefined);
  pt.fill([["m", 1, 2]], PAL.blue);
  const [path, circle, shade, plain] = pt.scene().items;
  if (path.kind !== "fill" || circle.kind !== "fill" || shade.kind !== "fill" || plain.kind !== "fill") throw new Error("four fills");
  eqList(path.path.coords, [2, 88, 2, 89, 4, 88, 6, 87], "every control point projected");
  // A circle's arcs start at (x + r, y) and every control point is mapped.
  eqList(circle.path.coords.slice(0, 2), [16, 85], "circle start projected");
  for (let k = 0; k < circle.path.coords.length; k += 2) {
    const x = circle.path.coords[k] / 2, y = 100 - circle.path.coords[k + 1] - 10;
    check(Math.abs(Math.sqrt((x - 5) ** 2 + (y - 5) ** 2) - 3) < 1.2, "circle points near the circle before projecting");
  }
  if (shade.paint.kind !== "linear") throw new Error("a gradient");
  // The axis is projected once: (0, 20) to (0, 40), turned over; the band
  // around it is laid in page coordinates, not projected again.
  eqList(shade.paint.from, [0, 80], "axis start");
  eqList(shade.paint.to, [0, 60], "axis end");
  eqList(shade.path.coords, [-5, 90, -5, 50, 5, 50, 5, 90], "band");
  eqList(plain.path.coords, [1, 98], "a cleared projection leaves paths alone");
});
