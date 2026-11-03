// An oval as a plant's frame (frames.ts): the plant grows along the curve
// as it grows up a straight margin. A frame point (x, y) lies at arclength
// s0 + y along the oval, x - xc along the inward normal; so the frame's
// left margin wraps round the outside of the oval and its text block lies
// inside it.
//
// The oval is walked clockwise from its foot: arclength 0 is the bottom
// centre, a quarter of the way round is the leftmost point. Positions and
// normals are taken from the ellipse itself, so the map is smooth; only
// the arclength-to-angle table is sampled.
import { mod } from "#platform";
import type { Projection } from "./paint.ts";

const PI = Math.PI;
const N = 1440;

export class Oval {
  readonly cx: number;
  readonly cy: number;
  readonly a: number;
  readonly b: number;
  readonly len: number;
  private readonly th: number[] = [];
  private readonly s: number[] = [0];

  // The oval centred at (cx, cy) with half-width a and half-height b.
  constructor(cx: number, cy: number, a: number, b: number) {
    this.cx = cx;
    this.cy = cy;
    this.a = a;
    this.b = b;
    let px = 0, py = 0;
    for (let i = 0; i <= N; i++) {
      const th = -PI / 2 - (2 * PI * i) / N;
      const x = cx + a * Math.cos(th), y = cy + b * Math.sin(th);
      this.th.push(th);
      if (i > 0) this.s.push(this.s[i - 1] + Math.sqrt((x - px) ** 2 + (y - py) ** 2));
      px = x;
      py = y;
    }
    this.len = this.s[N];
  }

  // The angle at arclength s, any real s.
  theta(s: number): number {
    s = mod(s, this.len);
    const S = this.s;
    let lo = 0, hi = N;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (S[mid] <= s) lo = mid;
      else hi = mid;
    }
    const u = (s - S[lo]) / (S[hi] - S[lo]);
    return this.th[lo] + (this.th[hi] - this.th[lo]) * u;
  }

  // The arclength at angle th, in [0, len).
  arclength(th: number): number {
    const k = mod((-PI / 2 - th) / (2 * PI), 1) * N;
    const i = Math.floor(k);
    return this.s[i] + (this.s[i + 1] - this.s[i]) * (k - i);
  }

  // The point and inward unit normal at angle th: [x, y, nx, ny].
  point(th: number): [number, number, number, number] {
    const x = this.cx + this.a * Math.cos(th), y = this.cy + this.b * Math.sin(th);
    // Walking clockwise the heading is (a sin, -b cos); inward is its right.
    const tx = this.a * Math.sin(th), ty = -this.b * Math.cos(th);
    const l = Math.sqrt(tx * tx + ty * ty);
    return [x, y, ty / l, -tx / l];
  }

  // The angle of the oval point nearest (px, py).
  nearest(px: number, py: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < 360; i++) {
      const th = -PI / 2 - (2 * PI * i) / 360;
      const d = (this.cx + this.a * Math.cos(th) - px) ** 2 + (this.cy + this.b * Math.sin(th) - py) ** 2;
      if (d < bd) {
        best = th;
        bd = d;
      }
    }
    // Newton steps on (P - p) . P' = 0.
    const a = this.a, b = this.b;
    for (let k = 0; k < 6; k++) {
      const c = Math.cos(best), s = Math.sin(best);
      const ex = this.cx + a * c - px, ey = this.cy + b * s - py;
      const f = ex * (-a * s) + ey * (b * c);
      const df = (a * s) ** 2 + (b * c) ** 2 + ex * (-a * c) + ey * (-b * s);
      if (Math.abs(df) < 1e-9) break;
      best -= f / df;
    }
    return best;
  }

  // The maps between a frame laid along the oval and the page: the frame's
  // y = 0 lies at arclength s0, its x = xc on the curve. `mirror` reflects
  // the result about the oval's vertical axis, for the right-hand plant.
  // The inverse returns frame y in (-len/4, 3 len/4], so a point past the
  // frame's foot comes back below it rather than beyond its top.
  maps(s0: number, xc: number, mirror = false): [Projection, Projection] {
    const cx = this.cx;
    const fn: Projection = (x, y) => {
      const [px, py, nx, ny] = this.point(this.theta(s0 + y));
      const d = x - xc;
      const qx = px + nx * d;
      return [mirror ? 2 * cx - qx : qx, py + ny * d];
    };
    const inv: Projection = (px, py) => {
      if (mirror) px = 2 * cx - px;
      const th = this.nearest(px, py);
      const [x, y, nx, ny] = this.point(th);
      let s = this.arclength(th);
      if (s > this.len * 0.75) s -= this.len;
      return [xc + (px - x) * nx + (py - y) * ny, s - s0];
    };
    return [fn, inv];
  }
}
