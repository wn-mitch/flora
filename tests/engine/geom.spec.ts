// Geometry that must come out the same on every target even where the
// targets' arithmetic differs in the last place: the cases where a
// rounding-level difference would otherwise become a visible one.
import { fmt } from "#platform";
import * as BR from "../../src/engine/brush.ts";
import * as G from "../../src/engine/geom.ts";
import type { Pt } from "../../src/engine/geom.ts";
import { Painter } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";
import { PLANT } from "../../src/engine/tune.ts";
import { check, eq, near, test } from "./harness.ts";
import { numbers } from "./scenes.ts";

test("a ribbon along one repeated point has a fixed normal, whatever its rounding noise", () => {
  // A hairline from a bloom's eye to a petal vertex at the eye: every point
  // the same, or an ulp apart where the spline's arithmetic rounds.
  const p: Pt = [60.625, 1023.962949164838];
  const exact: Pt[] = [];
  for (let i = 0; i < 13; i++) exact.push([p[0], p[1]]);
  const noisy: Pt[] = exact.map((q, i): Pt => [q[0], i === 4 || i === 5 ? q[1] + 1.1e-13 : q[1]]);
  const w = (t: number) => 0.02 + 0.1 * t * (1 - t);
  const a = G.ribbon(exact, w), b = G.ribbon(noisy, w);
  eq(a.length, b.length, "outline points");
  for (let i = 0; i < a.length; i++) {
    near(b[i][0], a[i][0], 1e-9, "x " + fmt(i, 0));
    near(b[i][1], a[i][1], 1e-9, "y " + fmt(i, 0));
  }
  // Heading 0, so the left side is straight up.
  near(a[0][0], p[0], 1e-12, "first left x");
  near(a[0][1], p[1] + 0.02, 1e-12, "first left y");
});

test("a ribbon still turns with its line where the points are apart", () => {
  const line: Pt[] = [[0, 0], [10, 0], [10, 10]];
  const r = G.ribbon(line, () => 1);
  near(r[0][1], 1, 1e-12, "start offset up");
  near(r[2][0], 9, 1e-12, "end offset left");
});

test("a stem a whole number of brush steps long resamples alike from either side of the boundary", () => {
  // A bent stem 300 pt long, 100 steps of 3 pt, and the same stem a hair
  // short (a straight one would not tell: the brush lays its marks by
  // fraction along the line). The short one must not lose a step.
  const paint = (short: number): number[] => {
    const l = 150 - short;
    const pt = new Painter({ width: 400, height: 300 });
    BR.stem(pt, new Rng("stem"), [[0, 50], [150, 50], [150 + 0.6 * l, 50 + 0.8 * l]], () => 2, PLANT);
    return numbers(pt.scene().items);
  };
  const whole = paint(0), short = paint(1e-12);
  check(whole.length > 0, "the stem paints");
  eq(short.length, whole.length, "numbers painted");
  for (let i = 0; i < whole.length; i++) near(short[i], whole[i], 1e-6, "number " + fmt(i, 0));
});

test("a long broken stroke follows its curve instead of cutting chords", () => {
  // 2000 pt round a circle of radius 200. At a fixed 32 points (10 per
  // piece) the pieces cut chords ~90 pt long, which leave the circle by
  // ~5 pt; resampled by length they stay within their width of it.
  const r = 200, n = 400, len = 2000;
  const line: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (len / r) * (i / n);
    line.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const wmax = 0.5;
  const pieces = BR.broken(new Rng("chords"), line, wmax, 0.3, 0);
  check(pieces.length > 2, "the stroke breaks into pieces");
  let worst = 0;
  for (const p of pieces) for (const q of p) worst = Math.max(worst, Math.abs(Math.sqrt(q[0] * q[0] + q[1] * q[1]) - r));
  check(worst <= wmax + 0.2, "a piece leaves the curve by " + fmt(worst, 2) + " pt");
});
