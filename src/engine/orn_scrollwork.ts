// The scrollwork layout's gilt frame (frames.ts): a band of gilt along the
// title's oval (oval.ts), its lengths joined by bosses, with a fine gilt
// fillet inside it, a crest at its head, C-scrolls and a tailpiece at its
// foot and a pair of scrolls with an acanthus leaf at each side, as on
// engraved title pages whose frames are pierced scrollwork. The band goes
// under the plants, which twine over it; head and foot go over them.
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import { toNumber } from "./mix.ts";
import * as Acanthus from "./orn_acanthus.ts";
import { GILDER } from "./orn_gild.ts";
import * as K from "./orn_kit.ts";
import { scroll } from "./orn_scroll.ts";
import type { TitleSpec } from "./orn_title.ts";
import { draw, pick, type Box, type OrnamentKind } from "./ornaments.ts";
import type { Oval } from "./oval.ts";
import { PAL, type Painter } from "./paint.ts";
import { Rng } from "./rng.ts";

const PI = Math.PI;

// The frame's band width, the boxes of its head and foot pieces (which the
// plants keep out of) and the kinds picked for them.
export interface Plan {
  readonly w: number;
  readonly crest?: OrnamentKind;
  readonly tail?: OrnamentKind;
  readonly head: Box;
  readonly foot: Box;
}

// Paint `fn` with gold and copper gilt, as an ornament's are.
function gilt(pt: Painter, fn: () => void): void {
  const was = pt.gild;
  pt.gild = GILDER;
  fn();
  pt.gild = was;
}

// The oval's point at arclength s, offset d inward: x, y, and the inward
// normal.
function at(ov: Oval, s: number, d: number): [number, number, number, number] {
  const [x, y, nx, ny] = ov.point(ov.theta(s));
  return [x + nx * d, y + ny * d, nx, ny];
}

// The closed outline of the band from arclength s0 to s1, between inward
// offsets d0 and d1.
function strip(ov: Oval, s0: number, s1: number, d0: number, d1: number): Pt[] {
  const n = Math.max(2, Math.ceil((s1 - s0) / 4));
  const outer: Pt[] = [], inner: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const o = at(ov, s, d0), q = at(ov, s, d1);
    outer.push([o[0], o[1]]);
    inner.push([q[0], q[1]]);
  }
  for (let i = inner.length - 1; i >= 0; i--) outer.push(inner[i]);
  return outer;
}

// The frame's plan for oval `ov` on page spec. Each pick has its own
// stream, so the choice never moves anything else.
export function plan(spec: TitleSpec, ov: Oval): Plan {
  const rng = new Rng(toNumber(spec.seed) ?? 1);
  const head = G.clamp(ov.a * 0.3, 52, 84);
  const foot = G.clamp(ov.a * 0.5, 80, 140);
  const top = ov.cy + ov.b, bot = ov.cy - ov.b;
  return {
    w: G.clamp(ov.a * 0.028, 4.5, 8),
    crest: pick(rng.fork("choose scrollwork crest"), "crest", spec.ornaments),
    tail: pick(rng.fork("choose scrollwork tailpiece"), "tailpiece", spec.ornaments),
    head: [ov.cx - head / 2, top - head * 0.42, ov.cx + head / 2, top + head * 0.58],
    foot: [ov.cx - foot / 2, bot - foot * 0.36, ov.cx + foot / 2, bot + foot * 0.28],
  };
}

// The band, its bosses and fillet: paint before the plants.
export function under(pt: Painter, _spec: TitleSpec, ov: Oval, p: Plan): void {
  const w = p.w, n = 20, len = ov.len, boss = w * 0.95;
  gilt(pt, () => {
    for (let k = 0; k < n; k++) {
      const s0 = (len * k) / n + boss * 0.6, s1 = (len * (k + 1)) / n - boss * 0.6;
      pt.fill(G.polyline(strip(ov, s0, s1, -w / 2, w / 2), true), PAL.gold, 0.95);
      // The fillet, a hairline of gold inside the band.
      pt.fill(G.polyline(strip(ov, s0 - boss * 0.5, s1 + boss * 0.5, w * 1.15, w * 1.15 + 0.7), true), PAL.gold, 0.9);
    }
    for (let k = 0; k < n; k++) {
      const [x, y] = at(ov, (len * k) / n, 0);
      pt.fill(K.dot(x, y, boss), PAL.gold, 0.95);
      pt.fill(K.dot(x, y, boss * 0.4), PAL.copper, 0.9);
    }
    // Beads along the outside of the band.
    for (let k = 0; k < n; k++) {
      const beads: Cmd[][] = [];
      for (let j = 1; j <= 5; j++) {
        const [x, y] = at(ov, (len * (k + j / 6)) / n, -w * 1.05);
        beads.push(K.dot(x, y, w * 0.18));
      }
      pt.fillMany(beads, PAL.gold, 0.9);
    }
  });
}

// A pair of C-scrolls and an acanthus leaf springing outward from the band
// at arclength s.
function side(pt: Painter, ov: Oval, s: number, size: number, w: number): void {
  const [x, y, nx, ny] = at(ov, s, -w * 0.5);
  const out = Math.atan2(-ny, -nx);
  for (const d of [-1, 1]) {
    scroll(pt, [x - ny * d * size * 0.12, y + nx * d * size * 0.12], out + d * 0.9, size * 0.55, -d, w * 0.75);
  }
  const [leaf, veins, eyes] = Acanthus.leaf([x, y], out, size * 0.9, { lobes: 3, curl: 0.15 });
  Acanthus.paintLeaves(pt, [leaf], veins, size, eyes);
}

// The head, foot and side pieces: paint after the plants.
export function over(pt: Painter, spec: TitleSpec, ov: Oval, p: Plan): void {
  const rng = new Rng(toNumber(spec.seed) ?? 1);
  const w = p.w;
  gilt(pt, () => {
    for (const s of [ov.len * 0.25, ov.len * 0.75]) side(pt, ov, s, G.clamp(ov.b * 0.16, 28, 52), w);
    // C-scrolls at the foot, curling out and up from the band's lowest
    // point.
    const fs = p.foot[2] - p.foot[0];
    for (const d of [-1, 1]) {
      scroll(pt, [ov.cx + d * fs * 0.1, ov.cy - ov.b - w * 0.6], PI / 2 - d * (PI / 2 + 0.35), fs * 0.36, d, w * 1.1);
    }
    // Two scrolls flanking the crest at the head, curling down the band.
    const hs = p.head[2] - p.head[0];
    for (const d of [-1, 1]) {
      scroll(pt, [ov.cx + d * hs * 0.32, ov.cy + ov.b + w * 0.3], PI / 2 - d * (PI / 2 - 0.25), hs * 0.42, -d, w * 0.85);
    }
  });
  if (p.crest !== undefined) draw(p.crest, pt, rng.fork("scrollwork crest"), p.head);
  if (p.tail !== undefined) {
    const fb = p.foot;
    const tw = (fb[2] - fb[0]) * 0.62, th = tw / 1.6;
    const cx = (fb[0] + fb[2]) / 2, y1 = ov.cy - ov.b - w * 1.2;
    draw(p.tail, pt, rng.fork("scrollwork tailpiece"), [cx - tw / 2, y1 - th, cx + tw / 2, y1]);
  }
}
