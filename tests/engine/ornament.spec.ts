// The registry picks kinds by weight and skips a slot whose kinds all
// weigh nothing; drawing gilds gold and restores the painter; sparkles
// land in free space and claim it.
import * as Fill from "../../src/engine/fill.ts";
import * as LA from "../../src/engine/layout.ts";
import * as ORN from "../../src/engine/ornaments.ts";
import { PAL, Painter } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";
import { check, eq, test } from "./harness.ts";
import { bodySpec, numbers } from "./scenes.ts";

test("the registry picks by weight, never a kind at 0, and nothing when all are", () => {
  for (const slot of ["cartouche", "header", "pendant", "gilt"]) check(ORN.of(slot).length > 0, slot + " has kinds");
  const seen: Record<string, number> = {};
  for (let i = 0; i < 300; i++) {
    const k = ORN.pick(new Rng(i), "gilt", { gilt_cross: 0 });
    if (k !== undefined) seen[k.name] = (seen[k.name] ?? 0) + 1;
  }
  eq(seen.gilt_cross ?? 0, 0, "a kind at 0 is never picked");
  check((seen.gilt_rosette ?? 0) > (seen.gilt_trefoil ?? 0), "weight 3 beats weight 1");
  const none: Record<string, number> = {};
  for (const k of ORN.of("pendant")) none[k.name] = 0;
  eq(ORN.pick(new Rng(1), "pendant", none) === undefined, true, "all at 0: nothing");
});

test("drawing an ornament gilds its gold, then restores the painter", () => {
  const flat = new Painter({ width: 300, height: 300 });
  flat.flatGilt = true;
  ORN.draw("compass", flat, new Rng(1), [100, 100, 140, 140]);
  const gilt = new Painter({ width: 300, height: 300 });
  ORN.draw("compass", gilt, new Rng(1), [100, 100, 140, 140]);
  eq(gilt.gild === undefined, true, "the gilder is cleared after");
  check(gilt.scene().items.length > flat.scene().items.length * 3, "gilt paints bevels, not flat gold");
  const golds = (p: Painter) => p.scene().items.filter((it) => it.kind === "fill" && it.paint.kind === "solid" && it.paint.rgb === PAL.gold).length;
  eq(golds(gilt), 0, "no flat gold left once gilt");
  for (const v of numbers(gilt.scene().items)) check(v === v && Math.abs(v) < 1e5, "every number finite");
});

test("sparkles land in free space, out of each other's way", () => {
  const [g] = LA.region(bodySpec());
  g.field();
  const items = Fill.sparkles(new Rng("s"), g, 40);
  check(items.length >= 20, "most of them find room");
  const [fresh] = LA.region(bodySpec());
  for (const s of items) check(fresh.free(s.x, s.y), "on free paper");
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = Math.sqrt((items[i].x - items[j].x) ** 2 + (items[i].y - items[j].y) ** 2);
      check(d > Math.max(items[i].r, items[j].r), "never on top of another");
    }
  }
  const none: Record<string, number> = {};
  for (const k of ORN.of("gilt")) none[k.name] = 0;
  const [g2] = LA.region(bodySpec());
  g2.field();
  check(Fill.sparkles(new Rng("s"), g2, 40, none).every((s) => s.r < 3.5), "with no larger gilt, only small sparkles");
});
