// A leaf with its wash on every target: grown alike from a seed, differently
// from another, with its gradient inside its clip and every number finite.
import { leaf, options } from "../../src/engine/leaf.ts";
import { Painter } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";
import { check, eq, test } from "./harness.ts";
import { grow, numbers } from "./scenes.ts";

test("a leaf grows alike from one seed and differently from another", () => {
  const a = numbers(grow("leaf 1").items), b = numbers(grow("leaf 1").items), c = numbers(grow("leaf 2").items);
  eq(a.length, b.length, "same seed, same size");
  let differ = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
  eq(differ, 0, "same seed, same numbers");
  check(a.length !== c.length || a.some((v, i) => v !== c[i]), "another seed grows another leaf");
});

test("a leaf is a halo, then its body clipped round a gradient, then its edge", () => {
  for (const seed of ["leaf 1", "leaf 2", "leaf 3", "leaf 4", "leaf 5"]) {
    const items = grow(seed).items;
    const clips = items.filter((it) => it.kind === "clip");
    eq(clips.length, 1, seed + ": one clip, round the blade");
    const clip = clips[0];
    if (clip.kind !== "clip") return;
    check(clip.items.some((it) => it.kind === "fill" && it.paint.kind === "linear"), seed + ": a gradient inside the clip");
    check(!items.some((it) => it.kind === "fill" && it.paint.kind === "linear"), seed + ": no gradient outside it");
    check(clip.items.length > 20, seed + ": brushwork, veins and grain inside the clip");
    check(items[0].kind === "stroke", seed + ": the halo first");
    for (const v of numbers(items)) check(v === v && Math.abs(v) < 1e6, seed + ": every number finite");
  }
});

test("each leaf shape grows", () => {
  // Small leaves are lance leaves; at 120 pt the mix picks feathers,
  // acanthus and lance leaves across seeds.
  const seen: Record<string, boolean> = {};
  for (let i = 0; i < 40; i++) {
    const r = new Rng(i);
    const o = options(r, 120, 0.4 + i * 0.13);
    seen[o.margin] = true;
    const pt = new Painter({ width: 300, height: 300 });
    leaf(pt, r, 150, 150, 0.4 + i * 0.13, o);
    pt.scene();
  }
  check(seen.feather === true && seen.acanthus === true && seen.entire === true, "feather, acanthus and lance leaves");
  eq(options(new Rng(3), 30, 1).margin, "entire", "a small leaf is a lance leaf");
});
