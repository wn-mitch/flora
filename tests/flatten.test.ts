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
