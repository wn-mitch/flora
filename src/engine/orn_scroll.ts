// Framed cartouches on the bare page: an oval in pierced scrollwork and a
// shield in flat strapwork, each round a small gilt vignette on a pale
// wash. The wash takes palette.cartouche.
import * as C from "./color.ts";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as K from "./orn_kit.ts";
import { register, type Box } from "./orn_registry.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

const PI = Math.PI;

// The pale ground's colour: the cartouche ink, much diluted.
function ground(pt: Painter): RGB {
  return C.recolor(PAL.sky, C.partInk("cartouche", pt.palette));
}

// A gilt vignette of size s at (x, y): a small sun, crescent, compass star
// or rosette, picked by rng. Returns which.
export function vignette(pt: Painter, rng: Rng, x: number, y: number, s: number): string {
  const kind = rng.weighted({ sun: 3, moon: 2, star: 2, rosette: 2 }) ?? "sun";
  if (kind === "sun") {
    const [lit, shade] = K.rays(x, y, s * 0.42, s, 12, { flames: true });
    K.gilt(pt, lit, shade);
    pt.fill(K.dot(x, y, s * 0.42), PAL.gold, 0.95);
    pt.fill(K.dot(x - s * 0.08, y + s * 0.08, s * 0.28), PAL.cream, 0.5);
  } else if (kind === "moon") {
    pt.fill(G.smooth(K.crescent(x, y, s * 0.8, 0.6, rng.range(-0.4, 0.4)), true), PAL.gold, 0.95);
    pt.fillMany(K.ring(x, y, s * 1.05, 5, s * 0.06, rng.range(0, PI)), PAL.gold, 0.8);
  } else if (kind === "star") {
    const [lit, shade] = K.rays(x, y, s * 0.12, s, 8, { short: 0.5, width: 0.28 });
    K.gilt(pt, lit, shade);
    pt.fill(K.dot(x, y, s * 0.1), PAL.cream, 1);
  } else {
    const petals: Cmd[][] = [];
    for (let k = 0; k < 8; k++) {
      const p = G.polar([x, y], (k * PI) / 4, s * 0.52);
      petals.push(G.smooth(K.ellipse(p[0], p[1], s * 0.42, s * 0.2, (k * PI) / 4, 16), true));
    }
    pt.fillMany(petals, PAL.gold, 0.7);
    pt.fill(K.dot(x, y, s * 0.24), PAL.copper, 0.9);
  }
  return kind;
}

// A gilt scroll: a copper shadow under a gold tapered ribbon, from p
// heading `ang`, of size s, curling by `dir`, w wide.
export function scroll(pt: Painter, p: Pt, ang: number, s: number, dir: number, w: number): void {
  const pts = K.scroll(p, ang, s, dir);
  const shadow: Pt[] = pts.map((q): Pt => [q[0] + w * 0.25, q[1] - w * 0.25]);
  pt.fill(K.taper(shadow, w, 0.25), PAL.copper, 0.7);
  pt.fill(K.taper(pts, w, 0.25), PAL.gold, 0.95);
}

// A heater shield: flat top, sides curving into a point at the foot,
// scaled by k about the top's centre. Points, closed.
function shield(cx: number, top: number, w: number, h: number, k: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([cx + (w / 2) * k * (1 - t ** 2.2), top - h * k * t]);
  }
  const out: Pt[] = [[cx - (w / 2) * k, top]];
  for (const q of pts) out.push(q);
  for (let i = pts.length - 2; i >= 0; i--) out.push([2 * cx - pts[i][0], pts[i][1]]);
  return out;
}

function scrolled(pt: Painter, rng: Rng, b: Box): void {
  const [cx, cy, w, h] = K.measure(b);
  const rx = w * 0.27, ry = h * 0.27;
  const s = Math.min(w, h);
  const oval = G.smooth(K.ellipse(cx, cy, rx, ry, 0, 40), true);
  pt.fill(oval, ground(pt), 0.3);
  pt.fill(G.smooth(K.ellipse(cx, cy + ry * 0.15, rx * 0.8, ry * 0.7, 0, 32), true), PAL.white, 0.35);
  // Scrolls: a pair at the head and the foot, curling outward, and one at
  // each side.
  const sw = s * 0.05;
  for (const d of [-1, 1]) {
    scroll(pt, [cx + d * rx * 0.25, cy + ry * 0.98], PI / 2 + d * -0.9, s * 0.34, -d, sw);
    scroll(pt, [cx + d * rx * 0.25, cy - ry * 0.98], -PI / 2 + d * 0.9, s * 0.34, d, sw);
    scroll(pt, [cx + d * rx * 0.98, cy + ry * 0.2], d > 0 ? -0.3 : PI + 0.3, s * 0.26, d, sw * 0.9);
  }
  pt.strokeMany([oval, G.smooth(K.ellipse(cx, cy, rx * 0.9, ry * 0.92, 0, 40), true)], PAL.gold, 0.55, 0.95);
  // Beads between the two rims, a trefoil crest and a drop below.
  const beads: Cmd[][] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k * PI) / 16;
    beads.push(K.dot(cx + rx * 0.95 * Math.cos(a), cy + ry * 0.96 * Math.sin(a), s * 0.012));
  }
  pt.fillMany(beads, PAL.gold, 0.9);
  pt.fillMany(K.trefoil(cx, cy + ry + s * 0.17, s * 0.13, PI / 2), PAL.gold, 0.95);
  pt.fill(G.smooth(K.leaf(cx, cy - ry - s * 0.06, s * 0.15, -PI / 2), true), PAL.gold, 0.95);
  vignette(pt, rng, cx, cy, s * 0.17);
}

function strapwork(pt: Painter, rng: Rng, b: Box): void {
  const [cx, cy, w, h] = K.measure(b);
  const s = Math.min(w, h);
  const top = cy + h * 0.27, sw = w * 0.62, sh = h * 0.6;
  const outer = G.polyline(shield(cx, top, sw, sh, 1), true);
  const inner = G.polyline(shield(cx, top - s * 0.05, sw, sh - s * 0.06, 0.84), true);
  pt.fill(outer, ground(pt), 0.3);
  // The strap: a flat band between two rims, rolled into a loop at each
  // top corner and pierced with an oval at each side.
  const band: Cmd[][] = [];
  for (const d of [-1, 1]) {
    const corner: Pt = [cx + (d * sw) / 2, top];
    band.push(G.smooth(K.ellipse(corner[0] + d * s * 0.07, corner[1] + s * 0.06, s * 0.1, s * 0.07, d * 0.5, 20), true));
    const side: Pt = [cx + d * sw * 0.52, top - sh * 0.38];
    band.push(G.smooth(K.ellipse(side[0] + d * s * 0.05, side[1], s * 0.06, s * 0.11, 0, 20), true));
  }
  pt.strokeMany(band, PAL.copper, 1.6, 0.55);
  pt.strokeMany(band, PAL.gold, 1.0, 0.95);
  pt.strokeMany([outer, inner], PAL.copper, 0.9, 0.5);
  pt.strokeMany([outer, inner], PAL.gold, 0.55, 0.95);
  // Rivets along the strap, on every other point.
  const rivets: Cmd[][] = [];
  const mid = shield(cx, top - s * 0.025, sw, sh - s * 0.03, 0.92);
  for (let i = 0; i < mid.length; i += 2) rivets.push(K.dot(mid[i][0], mid[i][1], s * 0.016));
  pt.fillMany(rivets, PAL.cream, 0.95);
  // A cresting of three trefoils above the flat top.
  for (let k = -1; k <= 1; k++) {
    pt.fillMany(K.trefoil(cx + k * sw * 0.3, top + s * 0.12, s * (k === 0 ? 0.12 : 0.08), PI / 2), PAL.gold, 0.9);
  }
  vignette(pt, rng, cx, top - sh * 0.42, s * 0.16);
}

export function registerScroll(): void {
  register({ name: "scrolled", slot: "cartouche", label: "Scrolled oval", reach: 0.02, draw: scrolled });
  register({ name: "strapwork", slot: "cartouche", label: "Strapwork shield", reach: 0.02, draw: strapwork });
}
