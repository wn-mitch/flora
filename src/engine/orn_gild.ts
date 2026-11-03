// Gilt for the ornaments: filled shapes, stroked lines and tooled dots,
// painted as gold in relief (orn_relief.ts), or flat when the painter has
// `flatGilt` set. Every part is an ordinary colour, so it survives a
// desktop printer or a grayscale copy. Light falls from the page's upper
// left whatever frame (a mirrored corner, say) the shape is drawn in.
// Raster gold, computed per pixel, is left to the renderer.
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import { KEEP, PAL, type Gilder, type Painter } from "./paint.ts";
import * as Relief from "./orn_relief.ts";

export const PALE: RGB = [0.965, 0.905, 0.700];
export const UMBER: RGB = [0.330, 0.200, 0.090];
KEEP.push(PALE, UMBER);

// Bounding box [x0, y0, x1, y1] of a list of paths.
export function bbox(paths: readonly (readonly Cmd[])[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r);
    x1 = Math.max(x1, x + r);
    y0 = Math.min(y0, y - r);
    y1 = Math.max(y1, y + r);
  };
  for (const cmds of paths) {
    for (const c of cmds) {
      if (c[0] === "m" || c[0] === "l") add(c[1], c[2]);
      else if (c[0] === "c") {
        add(c[1], c[2]);
        add(c[3], c[4]);
        add(c[5], c[6]);
      } else if (c[0] === "o") add(c[1], c[2], c[3]);
    }
  }
  return [x0, y0, x1, y1];
}

export interface GildOptions {
  readonly key?: number;    // keyline width, pt (0 for none)
  readonly shadow?: number; // drop-shadow offset, pt (0 for none)
  readonly tone?: Relief.Tone;
}

// Gild closed `paths`.
export function fill(pt: Painter, paths: readonly (readonly Cmd[])[], o: GildOptions = {}): void {
  if (paths.length === 0) return;
  pt.asMetal(() => {
    if (pt.flatGilt) {
      pt.fillMany(paths, o.tone === "shade" ? PAL.copper : PAL.gold, 0.95);
      return;
    }
    const b = bbox(paths);
    const size = Math.min(b[2] - b[0], b[3] - b[1]);
    const shadow = o.shadow ?? (o.tone === "shade" ? 0 : G.clamp(size * 0.02, 0.15, 0.6));
    Relief.paint(pt, paths, { tone: o.tone, shadow, key: o.key ?? Math.min(0.16, size * 0.04) });
  });
}

// Gild lines (open or closed paths) `w` wide: each a round gilt wire.
export function line(pt: Painter, paths: readonly (readonly Cmd[])[], w: number): void {
  pt.asMetal(() => {
    if (pt.flatGilt) {
      pt.strokeMany(paths, PAL.gold, w, 0.95);
      return;
    }
    // Fine wire is nearly all bevel; a shallower tilt and no keyline keep
    // it reading as gold rather than brown.
    const fine = w < 1;
    Relief.paintPolys(pt, Relief.ribbons(pt, paths, Math.max(w, 0.35)), { key: fine ? 0 : 0.1, tilt: fine ? 0.75 : undefined });
  });
}

// Tooled dots (pointillé): each a small gilt dome. `pts` are centres, r
// the radius.
export function dots(pt: Painter, pts: readonly Pt[], r: number): void {
  if (pts.length === 0) return;
  const paths = pts.map((p): Cmd[] => [["o", p[0], p[1], r]]);
  pt.asMetal(() => {
    if (pt.flatGilt) pt.fillMany(paths, PAL.gold, 0.95);
    else Relief.paint(pt, paths, { key: Math.min(0.1, r * 0.15) });
  });
}

// The painter's gilder while an ornament draws (ornaments.ts draw).
export const GILDER: Gilder = {
  fill: (pt, paths, tone) => fill(pt, paths, { tone }),
  line: (pt, paths, width) => line(pt, paths, width),
};
