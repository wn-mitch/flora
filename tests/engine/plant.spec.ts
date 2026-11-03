// The plant grows from its root along the foot, up the margin to the hero,
// bending no tighter than its limits, thinning at every fork, and keeping
// clear of the cartouche it is told to avoid.
import * as G from "../../src/engine/geom.ts";
import type { Pt } from "../../src/engine/geom.ts";
import * as LA from "../../src/engine/layout.ts";
import * as P from "../../src/engine/plant.ts";
import { Rng } from "../../src/engine/rng.ts";
import { GESTURE, PLANT } from "../../src/engine/tune.ts";
import { check, eq, near, test } from "./harness.ts";

const lines: LA.Box[] = [];
for (let i = 0; i < 48; i++) lines.push({ x0: 162, x1: i === 47 ? 300 : 436, y0: 712 - 12 * i, y1: 720 - 12 * i });
const SPEC: LA.PageSpec = { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
const HERO: P.Hero = [84.5, 606, 68.5];
const BOX: P.Rect = [40, 300, 90, 370];

test("the main stem runs from the root along the foot and up to the hero", () => {
  const [, m] = LA.region(SPEC);
  const [stems, corner] = LA.strands(new Rng("plant"), m, HERO, SPEC.width);
  const main = stems[0];
  check(main.main === true, "the main stem first");
  near(main.pts[0][0], SPEC.width * PLANT.root, 1e-9, "rooted at PLANT.root of the width");
  check(Math.abs(main.pts[0][1] - (m.y0 + 6)) < 5, "on the foot");
  const end = main.pts[main.pts.length - 1];
  check(G.dist(end, [HERO[0], HERO[1]]) < HERO[2] * 0.3, "ending under the hero");
  check(corner[1] > m.y0 && corner[0] < m.x1, "the corner is in the margin");
  // Steering holds the bend to PLANT.bend_radius; the final link to the
  // cap is a Bezier and is left out.
  const kmax = 1 / PLANT.bend_radius;
  let worst = 0;
  for (let i = 1; i + 1 < main.pts.length - 30; i++) {
    const a = G.angle(main.pts[i - 1], main.pts[i]), b = G.angle(main.pts[i], main.pts[i + 1]);
    worst = Math.max(worst, Math.abs(G.turn(b, a)) / G.dist(main.pts[i], main.pts[i + 1]));
  }
  check(worst <= kmax * 1.02, "no bend tighter than PLANT.bend_radius");
  const kinds: Record<string, number> = {};
  for (const st of stems) if (st.kind !== undefined) kinds[st.kind] = (kinds[st.kind] ?? 0) + 1;
  eq(kinds.long ?? 0, PLANT.long_shoots, "every long shoot grows");
  check((kinds.foot ?? 0) >= 3 && (kinds.crown ?? 0) >= 1, "foot shoots and a crown");
  for (const st of stems) if (st.kind !== undefined) check(st.tip !== undefined, "every shoot leaves its tip for compose");
});

test("stems thin at every fork, by the pipe model, but no further than their floor", () => {
  const st = P.stem([[0, 0], [0, 100]], 4, 4);
  near(st.width(0.5), 4, 1e-12, "no forks, full width");
  const w = P.fork(st, 0.5, 2.4, 0.5);
  near(w, 4, 1e-12, "the parent's width at the fork");
  near(st.width(0.25), 4, 1e-12, "below the fork, untouched");
  near(st.width(0.6), 4 * Math.sqrt(1 - 0.6 * 0.6), 1e-12, "beyond it, sqrt(1 - (cw/w)^2) of it");
  P.fork(st, 0.8, 3.9, 0.82);
  near(st.width(0.95), 4 * 0.8 * 0.82, 1e-12, "a wide child leaves the floor's share");
  st.min = 3;
  near(st.width(0.95), 3, 1e-12, "never below the stem's minimum");
});

test("the stems keep clear of the cartouche they avoid", () => {
  const [, m] = LA.region(SPEC);
  const inBox = (q: Pt) => q[0] > BOX[0] && q[0] < BOX[2] && q[1] > BOX[1] && q[1] < BOX[3];
  const [free] = LA.strands(new Rng("plant"), m, HERO, SPEC.width);
  // Without the rectangle, the main stem runs through it: the test bites.
  check(free[0].pts.some((q) => inBox(q)), "unavoided, the stem crosses the box");
  for (const seed of ["plant", "plant 2", "plant 3"]) {
    const [stems] = LA.strands(new Rng(seed), m, HERO, SPEC.width, undefined, BOX);
    check(!stems[0].pts.some((q) => inBox(q)), seed + ": the main stem goes round it");
  }
});

test("the region opens the margin and the room beside a short last line", () => {
  const [g, m] = LA.region(SPEC);
  eq(m.x1, 162 - 9, "the margin ends a gutter before the text");
  check(g.openAt(60, 400) && !g.textAt(60, 400), "the margin is open");
  check(g.textAt(300, 500), "a full line is text");
  // Below the last line (y 148) the text block is open across its width;
  // the last line itself is text only as far as it runs.
  check(!g.textAt(400, 125) && g.openAt(400, 125), "below the last line, open");
  check(g.textAt(250, 152) && !g.textAt(380, 152), "the short last line is text only to its end");
  check(g.textAt(200, 760), "the header is blocked");
});

test("the gesture bows inward and is densest at the hero and the bows", () => {
  const [, m] = LA.region(SPEC);
  const gest = LA.gesture(new Rng("g"), m, HERO);
  eq(gest.bows.length, GESTURE.bows, "GESTURE.bows bows");
  eq(gest.quiet.length, GESTURE.bows - 1, "a quiet stretch between each pair");
  for (const b of gest.bows) {
    near(gest.bow(b.y), b.amp, b.amp * 0.05, "a bow peaks at its height");
    near(gest.bow(b.y, 1000), 0, 1e-12, "shifted away, nothing");
  }
  for (let y = 0; y < 842; y += 7) {
    const d = gest.density(60, y);
    check(d >= GESTURE.density_floor - 1e-12 && d <= 1 + 1e-12, "density within its floor and 1");
  }
  check(gest.density(HERO[0], HERO[1]) > 0.99, "densest at the hero");
});

test("an excursion leaves only a page whose text stops well short", () => {
  check(LA.excursion(new Rng(1), SPEC, [380, 26]) === undefined, "a full page has none");
  const short: LA.PageSpec = { ...SPEC, lines: lines.slice(0, 20) };
  const e = LA.excursion(new Rng(1), short, [380, 26]);
  check(e !== undefined, "a short page has one");
  if (e === undefined) return;
  const lowest = 712 - 12 * 19;
  for (const q of e.pts) check(q[1] <= lowest - 30 + 1e-9, "it stays 30 pt under the lowest line");
});
