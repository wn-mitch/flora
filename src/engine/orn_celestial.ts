// Celestial cartouches: the night cartouche's frame and sky round a sun
// in splendour, a crescent moon, a constellation, a ringed planet or an
// armillary sphere. The sky takes palette.cartouche; gilt stays gold.
import { mod } from "#platform";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as O from "./ornament.ts";
import type { Field, Sky } from "./ornament.ts";
import * as K from "./orn_kit.ts";
import { register, type Box } from "./orn_registry.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

const PI = Math.PI;

// What runs inside or over a cartouche's field: the field, its width and
// height, and its centre.
type FieldFn = (this: void, f: Field, w: number, h: number, cx: number, cy: number) => void;

// Open a cartouche on box b, run inner clipped to its field, close the
// frame, then run over on top of it.
function cartouche(pt: Painter, rng: Rng, b: Box, sky: Sky | undefined, inner: FieldFn, over?: FieldFn): void {
  const f = O.panelOpen(pt, rng, b[0], b[1], b[2] - b[0], b[3] - b[1], sky);
  const w = f.x1 - f.x0, h = f.y1 - f.y0;
  const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2;
  pt.clipBegin(G.polyline(f.body, true));
  inner(f, w, h, cx, cy);
  pt.clipEnd();
  O.panelClose(pt, f);
  if (over !== undefined) over(f, w, h, cx, cy);
}

// Dust stars over the whole field, with no cloud.
function stars(pt: Painter, rng: Rng, f: Field): void {
  O.starfield(pt, rng, [], f.x0, f.y0, f.x1, f.y1);
}

// A pale dawn sky; the sun's flames and rays fill most of it.
function sun(pt: Painter, rng: Rng, b: Box): void {
  cartouche(pt, rng, b, { pigment: PAL.sky, strength: 0.45, light: [(b[0] + b[2]) / 2, b[1]] },
    (_f, w, h, cx, cy) => {
      const r = Math.min(w, h) * 0.2;
      pt.fillMany(K.ring(cx, cy, r * 2.05, 24, r * 0.05), PAL.white, 0.7);
      const glows = [1.9, 1.5, 1.2];
      for (let k = 1; k <= glows.length; k++) pt.fill(K.dot(cx, cy, r * glows[k - 1]), PAL.cream, 0.18 + 0.08 * k);
    },
    (_f, w, h, cx, cy) => {
      const r = Math.min(w, h) * 0.2;
      const [lit, shade] = K.rays(cx, cy, r * 1.02, Math.min(w, h) * 0.47, 16, { flames: true, rot: rng.range(0, PI / 8) });
      K.gilt(pt, lit, shade);
      pt.fill(K.dot(cx, cy, r), PAL.gold, 0.95);
      pt.fill(K.dot(cx - r * 0.18, cy + r * 0.2, r * 0.7), PAL.cream, 0.55);
      pt.stroke(K.dot(cx, cy, r), PAL.copper, 0.3, 0.9);
      pt.stroke(K.dot(cx, cy, r * 0.82), PAL.copper, 0.18, 0.6);
    });
}

function moon(pt: Painter, rng: Rng, b: Box): void {
  cartouche(pt, rng, b, undefined, (f, w, h, cx, cy) => {
    stars(pt, rng.fork("stars"), f);
    const r = Math.min(w, h) * 0.3;
    const x = cx + rng.jit(w * 0.06), y = cy + h * 0.06;
    const rot = rng.range(-0.5, 0.2);
    // Earthshine on the dark disc, then the lit crescent and its shading.
    pt.fill(K.dot(x, y, r), PAL.white, 0.08);
    pt.fill(G.smooth(K.crescent(x, y, r, 0.62, rot), true), PAL.white, 0.95);
    pt.fill(G.smooth(K.crescent(x, y, r * 0.98, 0.42, rot), true), f.dilute, 0.16);
    const seas: Cmd[][] = [];
    for (let i = 0; i < 5; i++) {
      const a = rot + PI + rng.jit(1.1);
      const p = G.polar([x, y], a, r * rng.range(0.62, 0.86));
      seas.push(K.dot(p[0], p[1], r * rng.range(0.05, 0.11)));
    }
    pt.fillMany(seas, f.dilute, 0.16);
    pt.fill(K.dot(x, y, r * 1.35), PAL.white, 0.06);
  }, (f, w, h, cx) => {
    // A gilt star below the horns.
    const s = Math.min(w, h) * 0.08;
    const p: Pt = [cx - w * 0.22, f.y0 + h * 0.2];
    pt.fill(G.polyline(K.star(p[0], p[1], s, s * 0.38, 5), true), PAL.gold, 0.9);
  });
}

function constellation(pt: Painter, rng: Rng, b: Box): void {
  cartouche(pt, rng, b, { strength: 1.2 }, (f, w, h, cx, cy) => {
    stars(pt, rng.fork("stars"), f);
    // A band of denser dust across the field, as the Milky Way.
    const band: Cmd[][] = [];
    const br = rng.fork("band");
    const a = br.range(0.5, 1.1);
    const n = Math.floor(w * h * 0.12);
    for (let i = 0; i < n; i++) {
      const t = br.range(-0.7, 0.7);
      const u = br.jit(1) * br.next();
      const p = G.polar([cx + t * w * Math.cos(a), cy + t * h * Math.sin(a)], a + PI / 2, u * w * 0.18);
      band.push(K.dot(p[0], p[1], br.range(0.08, 0.22)));
    }
    pt.fillMany(band, PAL.white, 0.45);
  }, (f, w, h) => {
    // Six to eight stars joined in a chain, with one branch.
    const cr = rng.fork("figure");
    const pts: Pt[] = [];
    let p: Pt = [f.x0 + w * cr.range(0.15, 0.3), f.y0 + h * cr.range(0.15, 0.3)];
    const n = cr.int(6, 8);
    for (let i = 0; i < n; i++) {
      pts.push(p);
      p = [G.clamp(p[0] + cr.range(-0.15, 0.32) * w, f.x0 + w * 0.12, f.x1 - w * 0.12),
        G.clamp(p[1] + cr.range(0.06, 0.2) * h, f.y0 + h * 0.1, f.y1 - h * 0.1)];
    }
    const lines = [G.polyline(pts, false)];
    // The branch leaves from a star other than the chain's ends: the
    // Lua's 1-based j in [2, #pts - 1] is index j - 1 here.
    const from = pts[cr.int(2, pts.length - 1) - 1];
    const spur: Pt = [from[0] + w * 0.18, from[1] - h * 0.08];
    lines.push(G.polyline([from, spur], false));
    pts.push(spur);
    pt.strokeMany(lines, PAL.gold, 0.25, 0.75);
    const glints: Cmd[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const s = Math.min(w, h) * (mod(i + 1, 3) === 1 ? 0.06 : 0.04);
      glints.push(G.polyline(K.star(pts[i][0], pts[i][1], s, s * 0.32, 4), true));
    }
    pt.fillMany(glints, PAL.gold, 0.95);
  });
}

function planet(pt: Painter, rng: Rng, b: Box): void {
  cartouche(pt, rng, b, undefined, (f, w, h, cx, cy) => {
    stars(pt, rng.fork("stars"), f);
    const r = Math.min(w, h) * 0.24;
    const tilt = rng.range(-0.45, -0.2);
    // The ring's far half behind the planet, its near half in front: of
    // the ring's 48 points, 0 to 24 or 24 to 48 (that is, 0 again).
    const half = (k: number, front: boolean): Cmd[] => {
      const pts = K.ellipse(cx, cy, r * k, r * k * 0.28, tilt, 48);
      const out: Pt[] = [];
      for (let i = front ? 0 : 24; i <= (front ? 24 : 48); i++) out.push(pts[mod(i, 48)]);
      return G.polyline(out, false);
    };
    pt.strokeMany([half(2.0, false), half(1.65, false)], PAL.gold, 0.5, 0.8);
    const disc = K.dot(cx, cy, r);
    pt.fill(disc, PAL.cream, 1);
    pt.clipBegin(disc);
    // Cloud bands across the globe, alternating copper and gold.
    for (let k = -4; k <= 4; k++) {
      const pts = K.ellipse(cx, cy + k * r * 0.24, r * 1.3, r * 0.07, tilt * 0.6, 24);
      pt.fill(G.smooth(pts, true), mod(k, 2) === 0 ? PAL.copper : PAL.gold, 0.22 + 0.04 * mod(k, 3));
    }
    pt.fill(G.smooth(K.crescent(cx, cy, r * 1.02, 0.7, tilt + PI * 0.8), true), f.deep, 0.45);
    pt.clipEnd();
    pt.strokeMany([half(2.0, true), half(1.65, true)], PAL.gold, 0.5, 0.9);
    const m = G.polar([cx, cy], rng.range(0.6, 1.2), r * 2.15);
    pt.fill(K.dot(m[0], m[1], r * 0.12), PAL.white, 0.9);
  });
}

function armillary(pt: Painter, rng: Rng, b: Box): void {
  cartouche(pt, rng, b, { pigment: PAL.sky, strength: 0.55 }, (f) => {
    stars(pt, rng.fork("stars"), f);
  }, (f, w, h, cx, cy) => {
    K.armillary(pt, cx, cy + h * 0.06, Math.min(w, h) * 0.32, rng.range(0.35, 0.5), f.y0 + h * 0.05);
  });
}

export function registerCelestial(): void {
  register({ name: "sun", slot: "cartouche", label: "Sun in splendour", draw: sun });
  register({ name: "moon", slot: "cartouche", label: "Crescent moon", draw: moon });
  register({ name: "constellation", slot: "cartouche", label: "Constellation", draw: constellation });
  register({ name: "planet", slot: "cartouche", label: "Ringed planet", draw: planet });
  register({ name: "armillary", slot: "cartouche", label: "Armillary sphere", draw: armillary });
}
