// Petals keep to their sectors, blooms grow alike from a seed, a tilted
// hero foreshortens its near and far petals, and florets batch by tint.
import { fmt } from "#platform";
import * as F from "../../src/engine/flower.ts";
import { Painter, type SceneItem } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";
import { check, eq, near, test } from "./harness.ts";
import { numbers } from "./scenes.ts";

const fills = (items: readonly SceneItem[]): number => {
  let n = 0;
  for (const it of items) n += it.kind === "clip" ? fills(it.items) : 1;
  return n;
};

test("a slotted petal stays inside its sector, however it bends", () => {
  for (const kind of ["fan", "wedge", "round", "obovate", "lance", "ghost"]) {
    for (let s = 0; s < 12; s++) {
      const r = new Rng(kind + fmt(s, 0));
      const sl = F.slot(5, 0.08, 0.09);
      const pts = F.petal(r, kind, 40, 40 * 0.44, r.jit(0.04), 0.15, sl);
      for (const [x, y] of pts) check(Math.abs(x) <= sl * Math.max(0, y) + 1e-9, kind + ": outline within slot * distance");
    }
  }
  // Unslotted, a broad petal does leave its sector, so the bound above is
  // the slot's doing.
  const wide = F.petal(new Rng(1), "wedge", 40, 40 * 0.44, 0, 0.15);
  check(wide.some(([x, y]) => Math.abs(x) > F.slot(5, 0.08, 0.09) * Math.max(0, y)), "an unslotted wedge is wider than the slot");
});

test("a petal is one closed outline from base to tip and back", () => {
  const pts = F.petal(new Rng(2), "obovate", 30, 10);
  eq(pts.length, 27 + 25, "27 points up the left, 25 back down the right");
  near(pts[0][0], 0, 1e-12, "it starts at the base");
  near(pts[26][0], 0, 1e-6, "the tip is on the axis");
  check(pts[26][1] > 26, "the tip is near the petal's length");
});

test("a bloom grows alike from one seed, differently from another", () => {
  const grow = (seed: string, style: string) => {
    const pt = new Painter({ width: 200, height: 200 });
    F.bloom(pt, new Rng(seed), 100, 100, 40, { style });
    return numbers(pt.scene().items);
  };
  for (const style of ["fan", "round", "soft", "obovate", "wedge"]) {
    const a = grow("b1", style), b = grow("b1", style), c = grow("b2", style);
    eq(a.length, b.length, style + ": same size");
    check(a.every((v, i) => v === b[i]), style + ": same numbers");
    check(a.length !== c.length || a.some((v, i) => v !== c[i]), style + ": another seed, another bloom");
    for (const v of a) check(v === v && Math.abs(v) < 1e6, style + ": every number finite");
  }
});

test("the tilted hero shrinks its far petals and enlarges its near ones", () => {
  const [fn, rh] = F.tilt(100, 100, 40, 35);
  const far = fn(100, 140)[1] - 100, near_ = 100 - fn(100, 60)[1];
  check(far > 0 && near_ > 0, "the rim stays on its side of the eye");
  check(far < near_, "the far rim comes in closer than the near one");
  check(rh < 40 * 1.2 && rh > 20, "the rim's half-height is foreshortened, not lost");
  const [flat] = F.tilt(100, 100, 40, 0);
  near(fn(100, 100)[0], 100, 1e-12, "the eye stays put");
  near(flat(100, 100)[1], 100, 1e-12, "untilted, the eye stays put");
  const pt = new Painter({ width: 300, height: 300 });
  F.hero(pt, new Rng("hero"), 150, 150, 50);
  const items = pt.scene().items;
  check(fills(items) > 50, "the hero paints its petals and eye");
  // The projection is cleared once the hero is done.
  pt.fill([["m", 1, 2]], [0, 0, 0]);
  const last = pt.scene().items[pt.scene().items.length - 1];
  eq(last.kind !== "timed" ? last.path.coords[0] : NaN, 1, "later paths are not projected");
});

test("a tilted bloom paints its calyx and returns where its stem meets it", () => {
  // The calyx tube, 0.42 R deep behind the cup, leans sin(tilt) of that
  // toward where the bloom faces.
  for (const facing of [Math.PI / 2, 2.4]) {
    const pt = new Painter({ width: 300, height: 300 });
    const at = F.tilted(pt, new Rng("lily"), 150, 150, 40, facing, 0.8);
    near(at[0], 150 + 0.42 * 40 * Math.sin(0.8) * Math.cos(facing), 1e-9, "stem point x");
    near(at[1], 150 + 0.42 * 40 * Math.sin(0.8) * Math.sin(facing), 1e-9, "stem point y");
  }
  const pt = new Painter({ width: 300, height: 300 });
  F.tilted(pt, new Rng("lily"), 150, 150, 40, Math.PI / 2, 0.8);
  check(fills(pt.scene().items) > 30, "calyx, sepals, petals and eye");
});

test("florets batch by tint, and soft ones sit in a halo", () => {
  const pt = new Painter({ width: 100, height: 100 });
  F.florets(pt, [
    { x: 10, y: 10, r: 2, tint: 1 }, { x: 20, y: 10, r: 2, tint: 1 }, { x: 30, y: 10, r: 0.5, tint: 3 },
    { x: 40, y: 10, r: 2, soft: true },
  ]);
  const items = pt.scene().items;
  // halo, deep, sky, soft blue, soft eye, rims, eyes, specks.
  eq(items.length, 8, "one fill per batch");
  const deep = items[1];
  if (deep.kind !== "fill") throw new Error("a fill");
  // Two florets of five petals, each under 2 pt: a move, two arcs, a close.
  eq(deep.path.verbs.length, 2 * 5 * 4, "both deep florets in one fill");
  const none = new Painter({ width: 10, height: 10 });
  F.florets(none, []);
  eq(none.scene().items.length, 0, "no florets, nothing painted");
});
