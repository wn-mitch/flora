// Size distributions drawn as curves (tune.ts SIZES): control points
// [x, weight] with x running 0-1 across the curve's range, increasing. The
// density between them is a monotone cubic spline (Fritsch-Carlson):
// smooth, but never overshooting its points, so it stays non-negative and
// peaks only where a point is placed.
import type { Rng } from "./rng.ts";
import type { SizeCurve } from "./tune.ts";

// Slopes for a monotone cubic through (xs[i], ys[i]).
function slopes(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
  for (let i = 0; i < n; i++) m.push(i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i], b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
  }
  return m;
}

// The spline through `points` ([x, w] pairs, x increasing) as a function of
// x in [0, 1]; flat beyond the end points.
export function spline(points: readonly (readonly [number, number])[]): (x: number) => number {
  const xs = points.map((p) => p[0]), ys = points.map((p) => Math.max(0, p[1]));
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const m = slopes(xs, ys);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t * t * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// The spline sampled at 65 even steps.
function weightsOf(c: SizeCurve): number[] {
  const f = spline(c.points);
  const w: number[] = [];
  for (let i = 0; i <= 64; i++) w.push(Math.max(0, f(i / 64)));
  return w;
}

// Draw one value from curve `c`: a step picked by its trapezoid's mass,
// then a place within it by inverting the step's linear density.
export function sample(rng: Rng, c: SizeCurve): number {
  const lo = c.range[0], hi = c.range[1];
  const w = weightsOf(c);
  const n = w.length;
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += (w[i] + w[i + 1]) / 2;
  if (total <= 0) return lo + (hi - lo) * rng.next();
  let r = rng.next() * total;
  for (let i = 0; i < n - 1; i++) {
    const a = w[i], b = w[i + 1];
    const mass = (a + b) / 2;
    if (r <= mass || i === n - 2) {
      r = Math.min(r, mass);
      // Inverse of the segment's CDF, a t + (b - a) t^2 / 2 = r.
      let t: number;
      if (Math.abs(b - a) < 1e-9) t = a > 0 ? r / a : 0.5;
      else t = (-a + Math.sqrt(Math.max(0, a * a + 2 * (b - a) * r))) / (b - a);
      t = Math.min(1, Math.max(0, t));
      return lo + ((hi - lo) * (i + t)) / (n - 1);
    }
    r -= mass;
  }
  return hi;
}
