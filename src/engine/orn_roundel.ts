// Round gilt ornaments: marks for the running head, pendants for the foot
// and the large centrepieces that crest a title.
import { mod } from "#platform";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as K from "./orn_kit.ts";
import { register } from "./orn_registry.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

const PI = Math.PI;

// An n-petalled rosette of radius r: pointed petals, lit and shaded,
// round a copper heart.
export function rosette(pt: Painter, x: number, y: number, r: number, n: number, rot = PI / 2): void {
  const lit: Cmd[][] = [], shade: Cmd[][] = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (k * 2 * PI) / n;
    const tip = G.polar([x, y], a, r);
    const l = G.polar([x, y], a + (PI / n) * 0.9, r * 0.42);
    const rr = G.polar([x, y], a - (PI / n) * 0.9, r * 0.42);
    lit.push(G.smooth([[x, y], l, tip], true, 0.4));
    shade.push(G.smooth([[x, y], tip, rr], true, 0.4));
  }
  K.gilt(pt, lit, shade);
  pt.fill(K.dot(x, y, r * 0.22), PAL.copper, 0.95);
  pt.fill(K.dot(x - r * 0.04, y + r * 0.04, r * 0.1), PAL.cream, 0.9);
}

// A four-lobed outline of radius r, as a closed path for a gilt line.
export function quatrefoil(x: number, y: number, r: number, rot = 0): Cmd[] {
  const pts: Pt[] = [];
  for (let k = 0; k < 64; k++) {
    const a = (k * 2 * PI) / 64;
    const rr = r * (0.72 + 0.28 * Math.abs(Math.cos(2 * (a - rot))) ** 0.6);
    pts.push(G.polar([x, y], a, rr));
  }
  return G.smooth(pts, true);
}

// A beaded cord running `len` up from (x, y); nothing under 4 pt.
function cord(pt: Painter, x: number, y: number, len: number | undefined, r: number): void {
  if (len === undefined || len < 4) return;
  const beads: Cmd[][] = [];
  for (let d = r * 2; d <= len; d += r * 2.6) beads.push(K.dot(x, y + d, r));
  pt.fillMany(beads, PAL.gold, 0.85);
}

// A wheel of twelve: twelve spokes and beads round a small sun.
export function zodiac(pt: Painter, x: number, y: number, r: number, rng?: Rng): void {
  pt.strokeMany([K.dot(x, y, r), K.dot(x, y, r * 0.82), K.dot(x, y, r * 0.4)], PAL.gold, Math.max(0.3, r * 0.03), 0.9);
  const spokes: Cmd[][] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * PI) / 6 + PI / 12;
    spokes.push(G.polyline([G.polar([x, y], a, r * 0.4), G.polar([x, y], a, r * 0.82)], false));
  }
  pt.strokeMany(spokes, PAL.gold, Math.max(0.2, r * 0.018), 0.85);
  // In each house, a sign: a dot, a pair, a crescent or a small star, in turn.
  const signs: Cmd[][] = [], stars: Cmd[][] = [];
  for (let k = 0; k < 12; k++) {
    const p = G.polar([x, y], (k * PI) / 6 + PI / 2, r * 0.61);
    const m = mod(k + (rng === undefined ? 0 : rng.int(0, 3)), 4);
    if (m === 0) signs.push(K.dot(p[0], p[1], r * 0.06));
    else if (m === 1) {
      for (let d = -1; d <= 1; d += 2) {
        const q = G.polar(p, (k * PI) / 6, d * r * 0.06);
        signs.push(K.dot(q[0], q[1], r * 0.035));
      }
    } else if (m === 2) signs.push(G.smooth(K.crescent(p[0], p[1], r * 0.075, 0.6, (k * PI) / 6), true));
    else stars.push(G.polyline(K.star(p[0], p[1], r * 0.09, r * 0.035, 5), true));
  }
  pt.fillMany(signs, PAL.gold, 0.9);
  pt.fillMany(stars, PAL.copper, 0.9);
  const [lit, shade] = K.rays(x, y, r * 0.17, r * 0.36, 12);
  K.gilt(pt, lit, shade);
  pt.fill(K.dot(x, y, r * 0.17), PAL.gold, 0.95);
  pt.fillMany(K.ring(x, y, r * 0.91, 36, Math.max(0.25, r * 0.022)), PAL.gold, 0.85);
}

// The wreath's two branches of paired leaves from the foot, meeting short
// of the top, with a bow at the foot and a star inside.
function wreath(pt: Painter, rng: Rng, x: number, y: number, s: number): void {
  const R = s * 0.38;
  const leaves: Cmd[][] = [], veins: Cmd[][] = [];
  for (const d of [-1, 1]) {
    const stem: Pt[] = [];
    for (let k = 0; k <= 24; k++) {
      const a = -PI / 2 + d * (0.22 + (k / 24) * (PI - 0.62));
      stem.push(G.polar([x, y], a, R));
    }
    veins.push(G.smooth(stem, false));
    for (let k = 2; k <= 24; k += 2) {
      const a = -PI / 2 + d * (0.22 + (k / 24) * (PI - 0.62));
      const p = G.polar([x, y], a, R);
      const along = a + (d * PI) / 2;
      const size = s * 0.075 * (1 - k / 60);
      for (const side of [-1, 1]) {
        leaves.push(G.smooth(K.ellipse(
          p[0] + Math.cos(along + side * 0.7) * size * 0.9, p[1] + Math.sin(along + side * 0.7) * size * 0.9,
          size, size * 0.38, along + side * 0.7, 14), true));
      }
    }
  }
  pt.strokeMany(veins, PAL.copper, 0.5, 0.8);
  pt.fillMany(leaves, PAL.gold, 0.9);
  for (const d of [-1, 1]) {
    pt.fill(G.smooth(K.ellipse(x + d * s * 0.06, y - R - s * 0.01, s * 0.06, s * 0.03, d * 0.4, 16), true), PAL.copper, 0.85);
    pt.fill(K.taper([[x, y - R], [x + d * s * 0.05, y - R - s * 0.08], [x + d * s * 0.09, y - R - s * 0.13]], s * 0.025, 0.4), PAL.copper, 0.85);
  }
  const [lit, shade] = K.rays(x, y, s * 0.03, s * 0.2, 8, { short: 0.45, width: 0.3, rot: PI / 2 + rng.jit(0.05) });
  K.gilt(pt, lit, shade);
}

// A compass rose of radius R: a ring of thirty-two ticks, sixteen points
// in three lengths, and a trefoil at the north.
function compassRose(pt: Painter, x: number, y: number, R: number): void {
  pt.strokeMany([K.dot(x, y, R * 0.78), K.dot(x, y, R * 0.7)], PAL.gold, 0.4, 0.9);
  const ticks: Cmd[][] = [];
  for (let k = 0; k < 32; k++) {
    const a = (k * PI) / 16;
    ticks.push(G.polyline([G.polar([x, y], a, R * 0.7), G.polar([x, y], a, R * (mod(k, 2) === 0 ? 0.78 : 0.74))], false));
  }
  pt.strokeMany(ticks, PAL.gold, 0.25, 0.85);
  // Each layer: point count, length, width (share of length) and offset.
  const layers: [number, number, number, number][] = [[16, R * 0.62, 0.16, PI / 16], [8, R * 0.8, 0.2, PI / 8], [4, R, 0.26, 0]];
  for (const [n, len, wide, off] of layers) {
    const lit: Cmd[][] = [], shade: Cmd[][] = [];
    for (let k = 0; k < n; k++) {
      const a = PI / 2 + off + (k * 2 * PI) / n;
      const tip = G.polar([x, y], a, len);
      const half = len * wide * 0.5;
      lit.push(G.polyline([[x, y], tip, G.polar([x, y], a + PI / 2, half)], true));
      shade.push(G.polyline([[x, y], tip, G.polar([x, y], a - PI / 2, half)], true));
    }
    K.gilt(pt, lit, shade);
  }
  pt.fillMany(K.trefoil(x, y + R * 1.02, R * 0.14, PI / 2), PAL.gold, 0.95);
  pt.fill(K.dot(x, y, R * 0.06), PAL.cream, 1);
  pt.stroke(K.dot(x, y, R * 0.06), PAL.copper, 0.25, 0.9);
}

export function registerRoundel(): void {
  // Running-head marks ------------------------------------------------------

  register({
    name: "rosette", slot: "header", label: "Rosette",
    draw: (pt, rng, b) => {
      const [x, y, , , s] = K.measure(b);
      // String keys sort as the Lua's numbers 6 and 8 do, in every target.
      rosette(pt, x, y, s * 0.5, rng.weighted({ "6": 1, "8": 2 }) === "6" ? 6 : 8);
    },
  });

  register({
    name: "sunburst", slot: "header", label: "Sunburst", reach: 0.2,
    draw: (pt, _rng, b) => {
      const [x, y, , , s] = K.measure(b);
      const [lit, shade] = K.rays(x, y, s * 0.17, s * 0.5, 16);
      K.gilt(pt, lit, shade);
      pt.strokeMany([G.polyline([[x - s * 0.7, y], [x + s * 0.7, y]], false)], PAL.gold, 0.2, 0.7);
      pt.fill(K.dot(x, y, s * 0.17), PAL.gold, 0.95);
      pt.fill(K.dot(x, y, s * 0.08), PAL.cream, 0.95);
    },
  });

  register({
    name: "quatrefoil", slot: "header", label: "Quatrefoil",
    draw: (pt, _rng, b) => {
      const [x, y, , , s] = K.measure(b);
      pt.strokeMany([quatrefoil(x, y, s * 0.48, PI / 4), quatrefoil(x, y, s * 0.36, PI / 4)], PAL.gold, 0.35, 0.95);
      const [lit, shade] = K.rays(x, y, s * 0.04, s * 0.26, 4, { short: 1, width: 0.4, rot: 0 });
      K.gilt(pt, lit, shade);
      pt.fillMany(K.ring(x, y, s * 0.42, 4, s * 0.035, PI / 4), PAL.gold, 0.9);
    },
  });

  // Pendants ----------------------------------------------------------------

  register({
    name: "medallion", slot: "pendant", label: "Rosette medallion",
    draw: (pt, rng, b, o) => {
      const [x, , w, h] = K.measure(b);
      const r = Math.min(w, h * 0.78) * 0.48;
      const cy = b[3] - r - 0.5;
      cord(pt, x, b[3], o.cord, 0.45);
      pt.strokeMany([K.dot(x, cy, r), K.dot(x, cy, r * 0.84)], PAL.gold, 0.32, 0.9);
      rosette(pt, x, cy, r * 0.62, 8, rng.range(0, PI / 8));
      // A drop below.
      pt.fill(G.smooth(K.lozenge(x, cy - r - (h - 2 * r) * 0.35, Math.max(1, (h - 2 * r) * 0.55), -PI / 2), true), PAL.gold, 0.9);
    },
  });

  register({
    name: "zodiac_pendant", slot: "pendant", label: "Zodiac pendant",
    draw: (pt, rng, b, o) => {
      const [x, , w, h] = K.measure(b);
      const r = Math.min(w, h) * 0.48;
      cord(pt, x, b[3], o.cord, 0.45);
      zodiac(pt, x, b[3] - r - 0.5, r, rng);
    },
  });

  // Crests ------------------------------------------------------------------

  register({
    name: "sun_crest", slot: "crest", label: "Sun crest",
    draw: (pt, rng, b) => {
      const [x, y, , , s] = K.measure(b);
      const R = s * 0.5;
      const [lit, shade] = K.rays(x, y, R * 0.36, R, 32, { flames: true, rot: rng.range(0, PI / 16) });
      K.gilt(pt, lit, shade);
      pt.fill(K.dot(x, y, R * 0.36), PAL.gold, 0.95);
      pt.fill(K.dot(x - R * 0.06, y + R * 0.06, R * 0.24), PAL.cream, 0.45);
      pt.strokeMany([K.dot(x, y, R * 0.36), K.dot(x, y, R * 0.3)], PAL.copper, 0.35, 0.9);
      rosette(pt, x, y, R * 0.2, 8);
    },
  });

  register({
    name: "compass_rose", slot: "crest", label: "Compass rose",
    draw: (pt, _rng, b) => {
      const [x, y, , , s] = K.measure(b);
      compassRose(pt, x, y, s * 0.46);
    },
  });

  register({
    name: "armillary_crest", slot: "crest", label: "Armillary crest",
    draw: (pt, rng, b) => {
      const [x, y, , , s] = K.measure(b);
      K.armillary(pt, x, y + s * 0.1, s * 0.32, rng.range(0.35, 0.5), b[1] + s * 0.04);
    },
  });

  register({
    name: "zodiac", slot: "crest", label: "Zodiac wheel",
    draw: (pt, rng, b) => {
      const [x, y, , , s] = K.measure(b);
      zodiac(pt, x, y, s * 0.47, rng);
    },
  });

  register({
    name: "wreath", slot: "crest", label: "Laurel wreath",
    draw: (pt, rng, b) => {
      const [x, y, , , s] = K.measure(b);
      wreath(pt, rng, x, y, s);
    },
  });
}
