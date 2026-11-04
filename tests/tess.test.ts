// Fills as triangles cover exactly what their rule fills (tess.ts): sampled
// on a grid, every point the winding fills is covered and none other is,
// once where the fill is cut whole; holes stay open, crossings are cut, and
// a field of separate dots costs no more than its fans.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rule } from "../src/display.ts";
import { fillTriangles, strokeTriangles } from "../src/tess.ts";

type Poly = Float32Array;
const poly = (pts: readonly [number, number][]): Poly => Float32Array.from([...pts, pts[0]].flat());

function circle(cx: number, cy: number, r: number, n = 24, ccw = false): Poly {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = ((ccw ? -k : k) / n) * 2 * Math.PI;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return poly(pts);
}

// A wobbly closed outline, concave in places.
function blot(cx: number, cy: number, r: number, seed: number): Poly {
  const pts: [number, number][] = [];
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * 2 * Math.PI, rr = r * (0.7 + 0.3 * Math.sin(seed + k * 1.7) * Math.cos(k * 0.9));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return poly(pts);
}

function triangles(subs: Poly[], rule: Rule): number[] {
  const out: number[] = [];
  fillTriangles(subs, rule, { push6: (a, b, c, d, e, f) => { out.push(a, b, c, d, e, f); } });
  return out;
}

// Winding of (x, y) about closed polylines `subs`.
function winding(subs: Poly[], x: number, y: number): number {
  let w = 0;
  for (const p of subs) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      if ((ay <= y) !== (by <= y)) {
        const t = (y - ay) / (by - ay);
        if (ax + t * (bx - ax) > x) w += by > ay ? 1 : -1;
      }
    }
  }
  return w;
}

// How many triangles of `t` hold (x, y).
function covers(t: number[], x: number, y: number): number {
  let n = 0;
  for (let i = 0; i < t.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = t.slice(i, i + 6);
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) n++;
  }
  return n;
}

// Every grid point off the edges: covered exactly as `rule` fills it, and
// `once` times at most where it is filled.
function agrees(subs: Poly[], rule: Rule, once: boolean, what: string): void {
  const t = triangles(subs, rule);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of subs) for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  for (let y = y0 - 2.13; y < y1 + 2; y += 1.37) {
    for (let x = x0 - 2.07; x < x1 + 2; x += 1.29) {
      const w = winding(subs, x, y);
      const inside = rule === "evenodd" ? (w & 1) !== 0 : w !== 0;
      const c = covers(t, x, y);
      if (!inside) assert.equal(c, 0, `${what}: (${x}, ${y}) is outside but covered ${c} times`);
      else if (once) assert.equal(c, 1, `${what}: (${x}, ${y}) is inside but covered ${c} times`);
      else assert.ok(c >= 1, `${what}: (${x}, ${y}) is inside but not covered`);
    }
  }
}

test("a concave outline is covered once inside and not at all outside", () => {
  agrees([blot(50, 50, 30, 1)], "nonzero", true, "blot");
  agrees([blot(50, 50, 30, 2)], "evenodd", true, "blot evenodd");
});

test("a hole wound against its ring stays open under nonzero", () => {
  agrees([circle(50, 50, 30), circle(50, 50, 12, 24, true)], "nonzero", true, "ring");
});

test("a star drawn in one stroke fills its centre under nonzero only", () => {
  const star: [number, number][] = [];
  for (let k = 0; k < 5; k++) {
    const a = ((k * 2) / 5) * 2 * Math.PI - Math.PI / 2;
    star.push([50 + Math.cos(a) * 40, 50 + Math.sin(a) * 40]);
  }
  agrees([poly(star)], "nonzero", true, "star nonzero");
  agrees([poly(star)], "evenodd", true, "star evenodd");
  assert.equal(covers(triangles([poly(star)], "evenodd"), 50, 52), 0, "the even-odd star's centre is open");
});

test("a bow tie's two lobes, wound opposite ways, are each covered once", () => {
  agrees([poly([[10, 10], [90, 90], [90, 10], [10, 90]])], "nonzero", true, "bow tie");
});

test("overlapping subpaths wound alike fill their union; under even-odd their overlap is open", () => {
  const two = [circle(40, 50, 25), circle(60, 50, 25)];
  agrees(two, "nonzero", false, "two circles");
  agrees(two, "evenodd", true, "two circles evenodd");
  assert.equal(covers(triangles(two, "evenodd"), 50, 50), 0);
});

test("a field of separate dots is cut dot by dot, no dearer than their fans", () => {
  const dots: Poly[] = [];
  for (let i = 0; i < 400; i++) dots.push(circle(5 + (i % 20) * 10 + ((i * 7) % 3), 5 + Math.floor(i / 20) * 10, 2 + (i % 3) * 0.5, 10));
  const t = triangles(dots, "nonzero");
  // A fan of each 10-gon is 8 triangles; cutting them together would make
  // a trapezoid of every dot in every slab.
  assert.ok(t.length / 6 <= 400 * 8, `${t.length / 6} triangles for 400 dots`);
  agrees(dots.slice(0, 60), "nonzero", true, "dots");
});

test("a stroke in a window keeps everything that reaches it", () => {
  const line = Float32Array.from(Array.from({ length: 200 }, (_, i) => [i * 2, 50 + Math.sin(i / 7) * 30]).flat());
  const all: number[] = [], part: number[] = [];
  strokeTriangles(line, 3, { push6: (...v) => { all.push(...v); } });
  strokeTriangles(line, 3, { push6: (...v) => { part.push(...v); } }, [150, 0, 250, 100]);
  assert.ok(part.length < all.length / 2, "most of the stroke is left out");
  for (let x = 150.3; x < 250; x += 1.7) {
    for (let y = 0.4; y < 100; y += 1.3) assert.equal(covers(part, x, y) > 0, covers(all, x, y) > 0, `(${x}, ${y})`);
  }
});
