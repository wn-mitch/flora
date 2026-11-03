// Pieces for a title page, after the printed book's ornaments: flourishes
// to set under a title (a fleuron rule, a headpiece band of printers'
// flowers), tailpieces to close it (a cul-de-lampe, a hedera leaf, a
// garland) and corner pieces.
import { mod } from "#platform";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as K from "./orn_kit.ts";
import { register, type Box } from "./orn_registry.ts";
import { rosette } from "./orn_roundel.ts";
import { scroll } from "./orn_scroll.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

const PI = Math.PI;

// Flourishes ---------------------------------------------------------------

// Two hedera leaves back to back, and rules tapering away from them.
function fleuronRule(pt: Painter, b: Box): void {
  const [cx, cy, w, h] = K.measure(b);
  const s = h * 0.38;
  const leaves = [G.smooth(K.lozenge(cx - s * 0.62, cy, s, PI), true), G.smooth(K.lozenge(cx + s * 0.62, cy, s, 0), true)];
  const rules: Cmd[][] = [];
  for (const d of [-1, 1]) rules.push(K.taper([[cx + d * s * 1.45, cy], [cx + d * w * 0.47, cy]], h * 0.05, 0.1));
  pt.fillMany(rules, PAL.gold, 0.9);
  pt.fillMany(leaves, PAL.copper, 0.6);
  pt.fill(G.smooth(K.lozenge(cx - s * 0.6, cy + s * 0.04, s * 0.92, PI), true), PAL.gold, 0.95);
  pt.fill(G.smooth(K.lozenge(cx + s * 0.6, cy + s * 0.04, s * 0.92, 0), true), PAL.gold, 0.95);
  pt.fill(K.dot(cx, cy, s * 0.14), PAL.copper, 0.95);
  const dots: Cmd[][] = [];
  for (const d of [-1, 1]) {
    for (let k = 0; k <= 2; k++) dots.push(K.dot(cx + d * (w * 0.485 - k * h * 0.12), cy, h * (0.045 - k * 0.01)));
  }
  pt.fillMany(dots, PAL.gold, 0.9);
}

// Printers' flowers along a band between two rules: hedera leaves turning
// up and down in turn, a rosette at each end.
function headpiece(pt: Painter, rng: Rng, b: Box): void {
  const [, cy, , h] = K.measure(b);
  const bh = h * 0.5;
  const x0 = b[0] + h * 0.35, x1 = b[2] - h * 0.35;
  const n = Math.max(5, Math.floor((x1 - x0) / (bh * 0.9)));
  const up: Cmd[][] = [], down: Cmd[][] = [];
  for (let k = 0; k < n; k++) {
    const x = x0 + ((k + 0.5) * (x1 - x0)) / n;
    const even = mod(k, 2) === 0;
    (even ? up : down).push(G.smooth(K.lozenge(x, cy - (even ? 0.32 : -0.32) * bh, bh * 0.58, even ? PI / 2 : -PI / 2), true));
  }
  pt.fillMany(up, PAL.gold, 0.92);
  pt.fillMany(down, PAL.copper, 0.8);
  const rules: Cmd[][] = [];
  for (const y of [cy + bh * 0.62, cy - bh * 0.62]) rules.push(G.polyline([[x0, y], [x1, y]], false));
  pt.strokeMany(rules, PAL.gold, 0.45, 0.95);
  for (const x of [b[0] + h * 0.3, b[2] - h * 0.3]) rosette(pt, x, cy, h * 0.3, 8, rng.range(0, PI / 8));
}

// Tailpieces ---------------------------------------------------------------

// Rows of fleurons narrowing to a point, then a hanging drop.
function culDeLampe(pt: Painter, rng: Rng, b: Box): void {
  const [cx, , w, h] = K.measure(b);
  const rows = [7, 5, 3, 1];
  const rh = h * 0.18;
  const s = Math.min(w / 8, rh) * 0.95;
  const gold: Cmd[][] = [], copper: Cmd[][] = [];
  // Rows count from 1 at the top, so the pattern's parity matches the Lua.
  for (let i = 1; i <= rows.length; i++) {
    const n = rows[i - 1];
    const y = b[3] - rh * (i - 0.5);
    for (let k = 0; k < n; k++) {
      const x = cx + (k - (n - 1) / 2) * s * 1.05;
      if (mod(k + i, 2) === 0) {
        for (const p of K.trefoil(x, y, s * 0.82, -PI / 2)) gold.push(p);
      } else {
        copper.push(G.smooth(K.leaf(x, y, s * 0.6, -PI / 2), true));
      }
    }
  }
  pt.fillMany(gold, PAL.gold, 0.92);
  pt.fillMany(copper, PAL.copper, 0.85);
  const tip = b[3] - rh * rows.length;
  pt.fill(G.smooth(K.leaf(cx, tip - h * 0.08, h * 0.12, -PI / 2), true), PAL.gold, 0.95);
  pt.fill(K.dot(cx, b[1] + h * 0.04, h * 0.025), PAL.gold, 0.9);
  pt.stroke(G.polyline([[cx, tip - h * 0.2], [cx, b[1] + h * 0.07]], false), PAL.gold, 0.3, 0.8);
  if (rng.chance(0.5)) {
    pt.stroke(G.polyline([[cx - s * 4, b[3] + h * 0.01], [cx + s * 4, b[3] + h * 0.01]], false), PAL.gold, 0.35, 0.85);
  }
}

// A hedera leaf with its shadow; the stalk curls up and over from the
// leaf's notch.
function hedera(pt: Painter, rng: Rng, b: Box): void {
  const [cx, cy0, w, h] = K.measure(b);
  const s = Math.min(w * 0.3, h * 0.5);
  const cy = cy0 + s * 0.4;
  const leaf = K.leaf(cx, cy - s * 0.2, s, -PI / 2);
  const shadow = leaf.map((q): Pt => [q[0] + s * 0.03, q[1] - s * 0.03]);
  pt.fill(G.smooth(shadow, true), PAL.copper, 0.7);
  pt.fill(G.smooth(leaf, true), PAL.gold, 0.95);
  const d = rng.chance(0.5) ? 1 : -1;
  scroll(pt, [cx, cy - s * 0.2 + s * 0.15], PI / 2 + d * 0.3, s * 1.1, -d, s * 0.08);
  pt.stroke(G.polyline([[cx, cy - s * 0.1], [cx, cy - s * 0.85]], false), PAL.copper, 0.35, 0.8);
  pt.fillMany([K.dot(cx - s * 1.1, cy - s * 0.4, s * 0.06), K.dot(cx + s * 1.1, cy - s * 0.4, s * 0.06)], PAL.gold, 0.9);
}

// A swag hanging between two rosettes: a cord with paired leaves along it,
// alternately gold and copper, largest at the low point.
function garland(pt: Painter, rng: Rng, b: Box): void {
  const [, cy, w, h] = K.measure(b);
  const x0 = b[0] + w * 0.12, x1 = b[2] - w * 0.12;
  const top = cy + h * 0.25, sag = h * 0.45;
  const cord: Pt[] = [], gold: Cmd[][] = [], copper: Cmd[][] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    cord.push([x0 + (x1 - x0) * t, top - sag * Math.sin(PI * t)]);
  }
  pt.stroke(G.smooth(cord, false), PAL.copper, 0.4, 0.8);
  for (let k = 1; k <= 9; k++) {
    const t = k / 10;
    const x = x0 + (x1 - x0) * t, y = top - sag * Math.sin(PI * t);
    const along = Math.atan2(-sag * PI * Math.cos(PI * t), x1 - x0);
    const size = h * 0.17 * (0.65 + 0.45 * Math.sin(PI * t));
    for (const sd of [-1, 1]) {
      const leaf = G.smooth(K.leaf(x, y, size, along + sd * 1.05, 0.55), true);
      (mod(k + (sd > 0 ? 1 : 0), 2) === 0 ? gold : copper).push(leaf);
    }
  }
  pt.fillMany(copper, PAL.copper, 0.8);
  pt.fillMany(gold, PAL.gold, 0.92);
  for (const x of [x0, x1]) {
    rosette(pt, x, top, h * 0.13, 8, rng.range(0, PI / 8));
    pt.fill(G.smooth(K.leaf(x, top - h * 0.3, h * 0.12, -PI / 2), true), PAL.copper, 0.85);
  }
}

// Corners ------------------------------------------------------------------

// Two tapered arms, a scroll on each, a rosette at the corner and a dot at
// each arm's end.
function bracket(pt: Painter, x0: number, y0: number, s: number): void {
  const w = s * 0.05;
  pt.fillMany([K.taper([[x0 + s * 0.08, y0 + s * 0.08], [x0 + s * 0.85, y0 + s * 0.08]], w, 0.2),
    K.taper([[x0 + s * 0.08, y0 + s * 0.08], [x0 + s * 0.08, y0 + s * 0.85]], w, 0.2)], PAL.gold, 0.92);
  scroll(pt, [x0 + s * 0.6, y0 + s * 0.08], PI / 2, s * 0.32, 1, w * 0.8);
  scroll(pt, [x0 + s * 0.08, y0 + s * 0.6], 0, s * 0.32, -1, w * 0.8);
  rosette(pt, x0 + s * 0.08, y0 + s * 0.08, s * 0.08, 8);
  pt.fillMany([K.dot(x0 + s * 0.93, y0 + s * 0.08, s * 0.025), K.dot(x0 + s * 0.08, y0 + s * 0.93, s * 0.025)], PAL.gold, 0.9);
}

// A leaf pointing into the corner, a scroll either side of it.
function cornerLeaf(pt: Painter, x0: number, y0: number, s: number): void {
  const c: Pt = [x0 + s * 0.42, y0 + s * 0.42];
  pt.fill(G.smooth(K.leaf(c[0], c[1], s * 0.36, (-3 * PI) / 4), true), PAL.gold, 0.95);
  scroll(pt, G.polar(c, PI / 4, s * 0.08), PI / 4 + 0.9, s * 0.42, 1, s * 0.04);
  scroll(pt, G.polar(c, PI / 4, s * 0.08), PI / 4 - 0.9, s * 0.42, -1, s * 0.04);
  pt.fill(K.dot(x0 + s * 0.06, y0 + s * 0.06, s * 0.035), PAL.gold, 0.9);
}

export function registerPieces(): void {
  register({ name: "fleuron_rule", slot: "flourish", label: "Fleuron rule", draw: (pt, _rng, b) => fleuronRule(pt, b) });
  register({ name: "headpiece", slot: "flourish", label: "Headpiece band", draw: headpiece });
  register({ name: "cul_de_lampe", slot: "tailpiece", label: "Cul-de-lampe", draw: culDeLampe });
  register({ name: "hedera", slot: "tailpiece", label: "Hedera leaf", draw: hedera });
  register({ name: "garland", slot: "tailpiece", label: "Garland", draw: garland });
  register({
    name: "bracket", slot: "corner", label: "Scrolled bracket",
    draw: (pt, _rng, b, o) => K.corner(pt, b, o, (x0, y0, s) => bracket(pt, x0, y0, s)),
  });
  register({
    name: "corner_leaf", slot: "corner", label: "Corner fleuron",
    draw: (pt, _rng, b, o) => K.corner(pt, b, o, (x0, y0, s) => cornerLeaf(pt, x0, y0, s)),
  });
}
