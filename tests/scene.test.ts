// Scenes become display lists without moving anything the engine painted:
// every verb, coordinate, colour, opacity, blend and clip comes through
// exactly, and malformed paths are refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Item } from "../src/display.ts";
import { Painter, Rng, leaf } from "../src/engine/index.ts";
import type { Scene, SceneItem, ScenePaint } from "../src/engine/paint.ts";
import { toDisplayList } from "../src/scene.ts";

// Every number compared with Object.is, so -0 and 0 differ.
function same(got: number, want: number, what: string): void {
  assert.ok(Object.is(got, want), `${what}: ${got} is not ${want}`);
}

function samePaint(got: Extract<Item, { kind: "fill" }>["paint"], want: ScenePaint, what: string): void {
  assert.equal(got.kind, want.kind, what);
  if (want.kind === "solid" && got.kind === "solid") {
    want.rgb.forEach((v, i) => same(got.rgb[i], v, `${what} rgb ${i}`));
  } else if (want.kind === "linear" && got.kind === "linear") {
    want.from.forEach((v, i) => same(got.from[i], v, `${what} from`));
    want.to.forEach((v, i) => same(got.to[i], v, `${what} to`));
    assert.equal(got.stops.length, want.stops.length, `${what} stops`);
    want.stops.forEach(([o, rgb], k) => {
      same(got.stops[k].offset, o, `${what} stop ${k}`);
      rgb.forEach((v, i) => same(got.stops[k].rgb[i], v, `${what} stop ${k} rgb`));
    });
  }
}

// Walks both lists together; returns how many numbers were compared.
function compare(got: readonly Item[], want: readonly SceneItem[], where: string): number {
  assert.equal(got.length, want.length, `${where}: item count`);
  let n = 0;
  want.forEach((w, k) => {
    const g = got[k], what = `${where}[${k}]`;
    assert.equal(g.kind, w.kind, what);
    if (w.kind !== g.kind) return;
    assert.equal(g.path.verbs.length, w.path.verbs.length, `${what} verbs`);
    w.path.verbs.forEach((v, i) => assert.equal(g.path.verbs[i], v, `${what} verb ${i}`));
    assert.equal(g.path.coords.length, w.path.coords.length, `${what} coords`);
    w.path.coords.forEach((v, i) => same(g.path.coords[i], v, `${what} coord ${i}`));
    n += w.path.coords.length;
    if (w.kind === "clip" && g.kind === "clip") {
      assert.equal(g.rule, w.rule, what);
      n += compare(g.items, w.items, `${what}.clip`);
    } else if (w.kind === "fill" && g.kind === "fill") {
      assert.equal(g.rule, w.rule, what);
      assert.equal(g.blend, w.blend, what);
      same(g.alpha, w.alpha, `${what} alpha`);
      samePaint(g.paint, w.paint, what);
    } else if (w.kind === "stroke" && g.kind === "stroke") {
      assert.equal(g.blend, w.blend, what);
      same(g.alpha, w.alpha, `${what} alpha`);
      same(g.width, w.width, `${what} width`);
      w.rgb.forEach((v, i) => same(g.rgb[i], v, `${what} rgb`));
    }
  });
  return n;
}

const AWKWARD = [0.1 + 0.2, -0, 1e-300, 5e-324, 123456789.123456789, -1 / 3, 2 ** 53 + 2, 1e300];

test("awkward doubles and nested clips come through exactly", () => {
  const scene: Scene = {
    width: 0.1 + 0.2, height: 1e-300,
    items: [
      { kind: "fill", path: { verbs: [0, 1, 2, 3], coords: AWKWARD.concat([0.7, 0.3]) }, paint: { kind: "solid", rgb: [0.1 + 0.2, -0, 1 / 3] }, rule: "evenodd", alpha: 1e-300, blend: "screen" },
      { kind: "clip", path: { verbs: [0, 1, 3], coords: [-0, 1e-300, 0.1 + 0.2, -1 / 3] }, rule: "nonzero", items: [
        { kind: "clip", path: { verbs: [0, 1], coords: [1, 2, 3, 4] }, rule: "evenodd", items: [
          { kind: "stroke", path: { verbs: [0, 2], coords: AWKWARD }, rgb: [-0, 5e-324, 1], width: 0.1 + 0.2, alpha: -0, blend: "multiply" },
        ] },
        { kind: "fill", path: { verbs: [0, 1], coords: [0, 0, 1, 1] }, paint: { kind: "linear", from: [-0, 0.1 + 0.2], to: [1e-300, 2 ** 53 + 2], stops: [[0, [-0, 0, 1]], [0.1 + 0.2, [1e-300, 0.5, 1]]] }, rule: "nonzero", alpha: 0.5, blend: "normal" },
      ] },
    ],
  };
  const list = toDisplayList(scene);
  same(list.width, scene.width, "width");
  same(list.height, scene.height, "height");
  assert.ok(compare(list.items, scene.items, "items") >= 24);
});

test("a painted leaf comes through exactly", () => {
  const pt = new Painter({ width: 200, height: 300 });
  const r = new Rng("leaf scene");
  leaf.leaf(pt, r, 100, 40, 1.4, leaf.options(r, 120, 1.4));
  const scene = pt.scene();
  const n = compare(toDisplayList(scene).items, scene.items, "leaf");
  assert.ok(n > 10000, `only ${n} coordinates compared`);
});

test("malformed paths are refused", () => {
  const fill = (verbs: number[], coords: number[]): Scene => ({
    width: 1, height: 1,
    items: [{ kind: "fill", path: { verbs, coords }, paint: { kind: "solid", rgb: [0, 0, 0] }, rule: "nonzero", alpha: 1, blend: "normal" }],
  });
  assert.throws(() => toDisplayList(fill([0, 4], [0, 0, 1, 1])), /verb 1 is 4/);
  assert.throws(() => toDisplayList(fill([0, -1], [0, 0])), /verb 1 is -1/);
  assert.throws(() => toDisplayList(fill([0, 1.5], [0, 0, 1, 1])), /verb 1 is 1.5/);
  assert.throws(() => toDisplayList(fill([0, 1], [0, 0, 1])), /take 4 coordinates, it has 3/);
  assert.throws(() => toDisplayList(fill([0, 2], [0, 0, 1, 1])), /take 8 coordinates, it has 4/);
  assert.throws(() => toDisplayList(fill([1], [0, 0])), /start with a move/);
  // Inside a clip too.
  const nested: Scene = { width: 1, height: 1, items: [{ kind: "clip", path: { verbs: [0], coords: [0, 0] }, rule: "nonzero", items: fill([0, 9], [0, 0]).items }] };
  assert.throws(() => toDisplayList(nested), /verb 1 is 9/);
});
