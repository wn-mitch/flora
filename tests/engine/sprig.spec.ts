// Size curves draw in proportion to their density, and the sprays collect
// their line work into batches that paint, laid down piece by piece when
// the painter keeps the timeline.
import { fmt } from "#platform";
import * as D from "../../src/engine/dist.ts";
import * as G from "../../src/engine/geom.ts";
import { Painter } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";
import * as S from "../../src/engine/sprig.ts";
import * as TL from "../../src/engine/timeline.ts";
import { SIZES } from "../../src/engine/tune.ts";
import { check, eq, eqList, near, test } from "./harness.ts";
import { covers, numbers } from "./scenes.ts";

test("a size curve draws in proportion to its density", () => {
  // A density rising linearly from 0 to 1 has its mean two thirds along.
  const r = new Rng("dist");
  const ramp = { range: [10, 40] as const, points: [[0, 0], [1, 1]] as const };
  let sum = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const v = D.sample(r, ramp);
    check(v >= 10 && v <= 40, "within the range");
    sum += v;
  }
  near(sum / n, 10 + 30 * (2 / 3), 0.6, "mean two thirds along");
  // A flat curve with no weight falls back to a uniform draw.
  const none = { range: [0, 1] as const, points: [[0, 0], [1, 0]] as const };
  for (let i = 0; i < 20; i++) check(D.sample(r, none) <= 1, "uniform fallback");
});

test("the spline passes through its points and never overshoots them", () => {
  for (const name of ["gyps", "leaf", "leaflet"]) {
    const pts = SIZES[name].points;
    const f = D.spline(pts);
    for (const [x, w] of pts) near(f(x), w, 1e-12, name + ": through its points");
    for (let i = 0; i + 1 < pts.length; i++) {
      const lo = Math.min(pts[i][1], pts[i + 1][1]), hi = Math.max(pts[i][1], pts[i + 1][1]);
      for (let k = 1; k < 20; k++) {
        const v = f(pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / 20);
        check(v >= lo - 1e-12 && v <= hi + 1e-12, name + ": stays between neighbouring points");
      }
    }
  }
});

test("a tendril's innermost turn keeps a 4 pt radius", () => {
  for (const len of [20, 60, 140, 200]) {
    const pts = S.tendril([0, 0], 0.3, len, 1);
    let turned = 0;
    for (let i = 1; i + 1 < pts.length; i++) {
      const step = G.dist(pts[i], pts[i + 1]);
      const da = Math.abs(G.turn(G.angle(pts[i - 1], pts[i]), G.angle(pts[i], pts[i + 1])));
      check(da <= step / 4 + 1e-9, fmt(len, 0) + ": curvature at most 1/4 per pt");
      turned += da;
    }
    // Long enough for the cap to allow it, a tendril winds a little over
    // a turn.
    if (len >= 100) check(turned > 2 * Math.PI && turned < 2 * Math.PI * 1.3, fmt(len, 0) + ": it winds through a turn or a little more");
  }
});

test("sprays fill a batch, which paints in a few fills", () => {
  const b = new S.Batch();
  S.umbel(b, new Rng("u"), [100, 100], 1.5, 40);
  S.cyme(b, new Rng("c"), [60, 60], 0.8, 50, 1);
  S.gypsophila(b, new Rng("g"), [140, 40], 1.4, 30, 4);
  check(b.florets.length > 40 && b.buds.length > 0, "florets and buds");
  // A dichasium of depth 4 forks at least twice at each level.
  check(b.florets.filter((f) => f.soft === true).length + b.stars.length >= 16, "a floret or star at every tip");
  const pt = new Painter({ width: 200, height: 200 });
  b.paint(pt);
  check(pt.scene().items.length < 20 + b.buds.length, "batched, not one fill per floret");
  let far = 0;
  b.eachPoint((x, y) => { far = Math.max(far, G.dist([x, y], [100, 100])); });
  check(far < 120, "every point near where it was grown");
});

test("a timed batch lays each line, floret and bud down from its own start", () => {
  const b = new S.Batch();
  b.line([[10, 10], [20, 20]], 1);
  b.line([[90, 90], [95, 95]], 1);
  b.floret(10, 12, 2, 0, 2);
  b.floret(90, 92, 2, 0, 2);
  b.bud(90, 90, 0, 5);
  // Born as far along as x: the near line and floret early, the rest late.
  const pt = new Painter({ width: 100, height: 100, timed: true });
  pt.births = (x: number) => x;
  b.paint(pt);
  const items = pt.scene().items;
  eq(items.length, 1, "one timed group");
  const group = items[0];
  if (group.kind !== "timed" || group.final === undefined) throw new Error("a timed group painted in parts");
  // A part for what starts at 10, another for what starts at 90.
  eq(group.items.length, 2, "two parts");
  const sweeps = group.items.flatMap((p) => (p.kind === "timed" ? p.sweeps : []));
  eq(sweeps.map((s) => s.kind).join(" "), "line disc line disc disc", "a sweep per line, floret and bud, part by part");
  eqList(sweeps.map((s) => s.b), [10, 10, 90, 90, 90], "each starts when the front reaches it");
  const all = new Painter({ width: 100, height: 100 });
  b.paint(all);
  eqList(numbers(group.final), numbers(all.scene().items), "once laid down, the batch painted whole");
  eqList(numbers(items), numbers(all.scene().items), "timing changes nothing finished");
  // At growth 40 the near line and floret are done, the rest not begun:
  // one clip over what is shown.
  // At growth 40 the near part is done and shows whole; the far part
  // has not begun.
  const shown = TL.frame(items, 40);
  const near = TL.frame(group.items.slice(0, 1), 1000);
  eqList(numbers(shown), numbers(near), "only the near part, whole");
  // Partway through the far part, one clip over what is shown.
  const mid = TL.frame(items, 92);
  const clip = mid[mid.length - 1];
  if (clip.kind !== "clip") throw new Error("a clip");
  // Scene coordinates run down from the top.
  check(covers(clip.path, 90, 10), "the far line's start is shown");
  check(!covers(clip.path, 95, 5), "its end is not yet");
  eqList(numbers(TL.frame(items, 1000)), numbers(all.scene().items), "the last frame is the finished batch");
  eq(TL.frame(items, 5).length, 0, "nothing before the first start");
});

test("leaflets alternate along a stem and stay on it", () => {
  const stem: [number, number][] = [[0, 0], [0, 100], [20, 200]];
  const items = S.leafletItems(new Rng("lf"), stem, [20, 30], 12);
  check(items.length >= 5 && items.length <= 11, "one every 20-30 pt");
  for (let i = 0; i < items.length; i++) {
    const [x, y, , len] = items[i];
    check(len >= 12 * 0.5 && len <= 12 * 2, "a leaflet size");
    check(x > -1 && x < 21 && y > 0 && y < 205, "on the stem");
  }
  eq(S.leafletItems(new Rng(1), stem, 300, 12).length, 0, "no leaflet on a stem shorter than the gap");
});
