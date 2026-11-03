// Flattening: polylines stay within a quarter pixel of the true curve at
// any scale, closed subpaths close, and degenerate ones go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PathBuilder } from "../src/display.ts";
import { flatten, bounds } from "../src/flatten.ts";

// Distance from (px, py) to segment a-b.
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

test("cubics flatten to within a quarter pixel of the curve", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const scale of [0.5, 1, 2, 3]) {
    let worst = 0;
    for (let n = 0; n < 300; n++) {
      // Curves the size of petals and stems: 2 to 200 units across.
      const size = 2 + rnd() * 198;
      const p = Array.from({ length: 8 }, () => rnd() * size);
      const path = new PathBuilder().moveTo(p[0], p[1]).cubicTo(p[2], p[3], p[4], p[5], p[6], p[7]).build();
      const [pts] = flatten(path, { scale, x0: 0, y0: 0 });
      for (let k = 0; k <= 64; k++) {
        const t = k / 64, u = 1 - t;
        const x = (u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6]) * scale;
        const y = (u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]) * scale;
        let best = Infinity;
        for (let i = 0; i + 3 < pts.length; i += 2) best = Math.min(best, segDist(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]));
        worst = Math.max(worst, best);
      }
      assert.equal(pts[pts.length - 2], Math.fround(p[6] * scale), "the polyline ends on the curve's end");
    }
    assert.ok(worst < 0.25, `at scale ${scale} a polyline strays ${worst.toFixed(3)} px from its curve`);
  }
});

test("a view shifts and scales every point", () => {
  const path = new PathBuilder().moveTo(10, 20).lineTo(30, 20).lineTo(30, 40).close().build();
  const [p] = flatten(path, { scale: 2, x0: 10, y0: 20 });
  assert.deepEqual([...p], [0, 0, 40, 0, 40, 40, 0, 0], "closed: back to the first point");
  assert.deepEqual(bounds([p], 1), [-1, -1, 41, 41]);
});

test("subpaths split at each move; single points are dropped", () => {
  const path = new PathBuilder().moveTo(0, 0).moveTo(1, 1).lineTo(2, 2).moveTo(5, 5).build();
  const subs = flatten(path, { scale: 1, x0: 0, y0: 0 });
  assert.equal(subs.length, 1);
  assert.deepEqual([...subs[0]], [1, 1, 2, 2]);
  assert.equal(bounds([], 0), null);
});

// Culling: a renderer skips what cannot reach its window and keeps the
// rest exactly, so a window onto part of a long list costs that part.
import { prepare } from "../src/webgl.ts";
import { reaches } from "../src/flatten.ts";
import type { DisplayList, Item } from "../src/display.ts";

const box = (x0: number, y0: number, x1: number, y1: number) =>
  new PathBuilder().moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).close().build();
const fill = (x0: number, y0: number, x1: number, y1: number): Item =>
  ({ kind: "fill", path: box(x0, y0, x1, y1), paint: { kind: "solid", rgb: [0, 0, 0] }, rule: "nonzero", alpha: 1, blend: "multiply" });

test("an item reaches a window only if its box, a stroke's grown by its width, meets it", () => {
  const v = { scale: 2, x0: 0, y0: 100 };  // the window is user y 100..150 at 100 x 100 px
  assert.equal(reaches(fill(0, 0, 10, 99), v, 100, 100), false, "wholly above");
  assert.equal(reaches(fill(0, 151, 10, 200), v, 100, 100), false, "wholly below");
  assert.equal(reaches(fill(0, 90, 10, 101), v, 100, 100), true, "straddling the top");
  // A line 4 units above the window, 10 units wide: its ink reaches 1 unit in.
  const line = new PathBuilder().moveTo(0, 96).lineTo(50, 96).build();
  assert.equal(reaches({ kind: "stroke", path: line, rgb: [0, 0, 0], width: 10, alpha: 1, blend: "normal" }, v, 100, 100), true, "a wide stroke's edge");
  assert.equal(reaches({ kind: "stroke", path: line, rgb: [0, 0, 0], width: 1, alpha: 1, blend: "normal" }, v, 100, 100), false, "a thin stroke");
  // A curve's control point may leave its points' range; the box holds it.
  const arc = new PathBuilder().moveTo(0, 90).cubicTo(10, 130, 20, 130, 30, 90).build();
  assert.equal(reaches({ kind: "fill", path: arc, paint: { kind: "solid", rgb: [0, 0, 0] }, rule: "nonzero", alpha: 1, blend: "normal" }, v, 100, 100), true, "a curve bowing in");
});

test("prepare skips what is out of the window, clips with their contents, and keeps the rest exactly", () => {
  const inside = fill(5, 110, 20, 130), above = fill(5, 0, 20, 50);
  const clipOut: Item = { kind: "clip", path: box(0, 300, 50, 400), rule: "nonzero", items: [fill(0, 0, 50, 400)] };
  const list: DisplayList = { width: 50, height: 400, items: [above, inside, clipOut] };
  const v = { scale: 2, x0: 0, y0: 100 };
  const all = prepare(list, v), win = prepare(list, v, { w: 100, h: 100 });
  assert.equal(all.ops.length, 5, "unculled: two fills, a clip, its fill and its unclip");
  assert.equal(win.ops.length, 1, "culled: only the fill in the window");
  const only = prepare({ ...list, items: [inside] }, v);
  assert.deepEqual([...win.verts], [...only.verts], "the kept fill's geometry is unchanged");
});
