// Paths as polylines in device pixels, for renderers that draw triangles.

import { CLOSE, CUBIC, LINE, MOVE, type Path } from "./display.ts";

// User units to device pixels: x' = (x - x0) * scale, y' = (y - y0) * scale.
export interface View {
  readonly scale: number;
  readonly x0: number;
  readonly y0: number;
}

// How far, in device px, a polyline may stray from its curve, and the
// most segments one cubic becomes. Split uniformly into n segments, a cubic
// strays at most 3/4 M / n^2, where M is the larger of its control
// points' second differences |P0 - 2 P1 + P2| and |P1 - 2 P2 + P3|.
const TOLERANCE = 0.2, MAX_STEPS = 64;

// Each subpath of `path` as a flat [x0, y0, x1, y1, ...] array in device
// px. A closed subpath ends on its first point; one with fewer than two
// points is dropped.
export function flatten(path: Path, v: View): Float32Array[] {
  const { verbs, coords } = path;
  const s = v.scale;
  const out: Float32Array[] = [];
  let pts: number[] = [];
  let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  const end = () => {
    if (pts.length >= 4) out.push(Float32Array.from(pts));
    pts = [];
  };
  for (let i = 0; i < verbs.length; i++) {
    const verb = verbs[i];
    if (verb === MOVE) {
      end();
      cx = sx = coords[k++];
      cy = sy = coords[k++];
      pts.push((cx - v.x0) * s, (cy - v.y0) * s);
    } else if (verb === LINE) {
      cx = coords[k++];
      cy = coords[k++];
      pts.push((cx - v.x0) * s, (cy - v.y0) * s);
    } else if (verb === CUBIC) {
      const x1 = coords[k], y1 = coords[k + 1], x2 = coords[k + 2], y2 = coords[k + 3], x3 = coords[k + 4], y3 = coords[k + 5];
      k += 6;
      const M = Math.max(Math.hypot(cx - 2 * x1 + x2, cy - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3)) * s;
      const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil(Math.sqrt((0.75 * M) / TOLERANCE))));
      for (let j = 1; j <= steps; j++) {
        const t = j / steps, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        pts.push((a * cx + b * x1 + c * x2 + d * x3 - v.x0) * s, (a * cy + b * y1 + c * y2 + d * y3 - v.y0) * s);
      }
      cx = x3;
      cy = y3;
    } else if (verb === CLOSE) {
      if (pts.length >= 2 && (cx !== sx || cy !== sy)) pts.push((sx - v.x0) * s, (sy - v.y0) * s);
      cx = sx;
      cy = sy;
    } else {
      throw new Error(`path: unknown verb ${verb}`);
    }
  }
  end();
  return out;
}

// The device-px box [x0, y0, x1, y1] round `subs`, or null when empty.
export function bounds(subs: readonly Float32Array[], pad = 0): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of subs) {
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
  }
  return x0 <= x1 ? [x0 - pad, y0 - pad, x1 + pad, y1 + pad] : null;
}
