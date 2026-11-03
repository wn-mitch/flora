// Growth fills the margin without touching the text, respects each
// motif's cap and the page's mix, and the mix itself scales what it says.
import * as Fill from "../../src/engine/fill.ts";
import { ORDER } from "../../src/engine/inks.ts";
import * as LA from "../../src/engine/layout.ts";
import * as MX from "../../src/engine/mix.ts";
import { COMPOSE } from "../../src/engine/tune.ts";
import { check, eq, near, test } from "./harness.ts";
import { bodySpec, growPage } from "./scenes.ts";

test("growth fills the margin and keeps every spray off the text", () => {
  const [g, ctx] = growPage("grow 1");
  check(ctx.leaves.length > 10 && ctx.blooms.length > 3 && ctx.sprays.florets.length > 100, "leaves, blooms and sprays");
  // A fresh region knows only the text and the margin: every spray point,
  // with its radius, must lie in open space there.
  const [fresh] = LA.region(bodySpec());
  check(Fill.fits(fresh, ctx.sprays), "every spray clears the text");
  check(Fill.fits(fresh, ctx.stemBatch), "every bloom stalk clears the text");
  for (const l of ctx.leaves) check(!fresh.textAt(l.at[0], l.at[1]), "no leaf rooted on the text");
  check(g.coverage() > 0.3, "the margin is mostly filled");
});

test("each motif keeps to its cap, and the mix moves the caps", () => {
  const [, plain] = growPage("caps");
  check((plain.counts.lily ?? 0) <= 1 && (plain.counts.umbel ?? 0) <= 3 && (plain.counts.bloom ?? 0) <= COMPOSE.small_blooms, "caps hold");
  const [, mixed] = growPage("caps", { lily: 3, umbel: 0 });
  eq(mixed.counts.umbel ?? 0, 0, "umbel=0 grows none");
  check((mixed.counts.lily ?? 0) <= 3, "lily=3 allows three");
  const [, sparse] = growPage("caps", { density: 0.5 });
  check(sparse.leaves.length + sparse.sprays.florets.length < plain.leaves.length + plain.sprays.florets.length, "a lower density grows less");
});

test("the mix scales the composition and leaves neutral pages alone", () => {
  check(MX.cfg(COMPOSE, { lily: 2 }) === COMPOSE, "motif weights do not touch the composition");
  const c = MX.cfg(COMPOSE, { density: 0.5, leaves: 0, leaflets: 2 });
  near(c.hole_min, COMPOSE.hole_min * 2, 1e-12, "half the density, twice the smallest hole");
  eq(c.leaves, 0, "leaves=0, no leaves");
  near(c.leaflet_spacing[0], COMPOSE.leaflet_spacing[0] / (2 * 0.5), 1e-12, "leaflet spacing by weight and density");
  eq(c.no_leaflets === true, false, "leaflets kept");
  eq(MX.cfg(COMPOSE, { leaflets: 0 }).no_leaflets === true, true, "leaflets=0, none");
  const m = { kind: "umbel", w: 1.6, cap: 3, rmin: 12, rmax: 20 };
  check(MX.motif(m) === m, "weight 1 returns the motif itself");
  eq(MX.motif(m, { umbel: 0 }) === undefined, true, "weight 0 drops it");
  eq(MX.motif(m, { umbel: 0.1 })?.cap ?? -1, 1, "a cap never falls below one");
  const d = MX.density((x) => x, { density: 3 });
  eq(d(0.5, 0), 1, "density is capped at 1");
});

test("a random palette part resolves to one ink, the same for a seed and spin", () => {
  const p = { leaves: "random", stems: "chiku-rin", blooms: "look" };
  const a = MX.resolve(p, 7, 0), b = MX.resolve(p, "7", 0), c = MX.resolve(p, 7, 1);
  if (a === undefined || b === undefined || c === undefined) throw new Error("a palette");
  check(ORDER.includes(a.leaves), "an ink");
  eq(a.leaves, b.leaves, "a seed given as text is the same seed");
  eq(a.stems, "chiku-rin", "named inks stay");
  eq(a.blooms, "look", "looks stay");
  let moved = false;
  for (let spin = 1; spin < 6; spin++) if (MX.resolve(p, 7, spin)?.leaves !== a.leaves) moved = true;
  check(moved || c.leaves !== a.leaves, "spinning changes the ink");
  eq(MX.resolve(p, "not a number", 0)?.leaves ?? "", MX.resolve(p, 1, 0)?.leaves ?? "-", "a seed that is not a number counts as 1");
  eq(MX.resolve(undefined, 1, 0) === undefined, true, "no palette, none");
});
