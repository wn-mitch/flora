// Flourishes to set under a title, after three hands: the writing
// master's pen (a copperplate flourish of crossing ovals and a pen swash),
// the printer's case (the swelled rule) and the medieval flourisher's
// penwork (fleuronnée). Pen kinds come in ink or in gilt; printed kinds in
// gilt.
//
// Copperplate rules followed here: the strokes are ovals and compound
// curves, never circles; loops cross near right angles; a shade (a
// downstroke) only ever crosses a hairline; each half winds out to a curl.
import { mod } from "#platform";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as Gild from "./orn_gild.ts";
import * as K from "./orn_kit.ts";
import * as Pen from "./orn_pen.ts";
import { register, type Box } from "./orn_registry.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

const PI = Math.PI;

// A dot to paint: centre and radius.
type Dot = readonly [number, number, number];

// Paint pen-stroke outlines `polys` (point lists) in ink, or gilt when
// `gilt` is set; `dots` are terminals. (The Lua gilt also names a bevel
// and a light for its raster gold, which the vector relief sizes itself.)
function ink(pt: Painter, polys: readonly (readonly Pt[])[], dots: readonly Dot[], gilt: boolean): void {
  const paths: Cmd[][] = polys.map((p) => G.polyline(p, true));
  for (const d of dots) paths.push(K.dot(d[0], d[1], d[2]));
  if (gilt) Gild.fill(pt, paths, { key: 0.06, shadow: 0 });
  else pt.fillMany(paths, PAL.ink, 0.9, { blend: "multiply" });
}

// Copperplate -----------------------------------------------------------------

// One half of a copperplate flourish, written from the centre outward in
// units of about the flourish's height: a lead out of the centre, a flat
// oval loop on the line (its falling shade crosses the rising hairline
// that entered it), a compound curve, and a curl winding in at the end.
function copperplateHalf(rng: Rng): Pt[] {
  const [lead, a] = Pen.path([0.08, 0], 0, [
    [rng.range(0.3, 0.5), rng.range(0.02, 0.06), "bell"], [rng.range(0.3, 0.5), -rng.range(0.02, 0.06), "bell"]]);
  const side = rng.chance(0.7) ? 1 : -1;
  const loop = Pen.loop(lead[lead.length - 1], a, rng.range(0.5, 0.75), rng.range(0.26, 0.38), rng.range(0.45, 0.8), side);
  const segs: Pen.Seg[] = [];
  const waves = rng.int(1, 2);
  const L = rng.range(0.8, 1.2) / waves;
  for (let i = 1; i <= waves; i++) {
    const amp = rng.range(0.04, 0.07) * (mod(i, 2) === 1 ? -side : side);
    segs.push([L, amp, "bell"], [L, -amp, "bell"]);
  }
  const curl = rng.chance(0.6) ? 1 : -1;
  segs.push([rng.range(0.25, 0.4), curl * 0.08, "c"]);
  segs.push([rng.range(0.8, 1.1), curl * rng.range(1.0, 1.4), "in"]);
  const tail = Pen.path(loop[loop.length - 1], a, segs)[0];
  const pts: Pt[] = [];
  for (const part of [lead, loop, tail]) {
    for (let i = pts.length > 0 ? 1 : 0; i < part.length; i++) pts.push(part[i]);
  }
  return pts;
}

// Points turned about the origin so that the first and last lie level.
function level(pts: readonly Pt[]): Pt[] {
  return G.transform(pts, 0, 0, -G.angle(pts[0], pts[pts.length - 1]));
}

// A stroke of a copperplate flourish; `solid` ones are filled as drawn
// rather than written with the pen.
interface Stroke {
  readonly pts: Pt[];
  readonly solid: boolean;
}

// A swelled rule from x0 to x1 about height y, `t` thick at its middle:
// a lens tapering to hairline points. Points, closed.
function lens(x0: number, x1: number, y: number, t: number, pw = 1.4): Pt[] {
  const top: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const f = i / 40;
    top.push([x0 + (x1 - x0) * f, y + (t / 2) * Math.sin(PI * f) ** pw + 0.06]);
  }
  const out = top.slice();
  for (let i = top.length - 2; i >= 1; i--) out.push([top[i][0], 2 * y - top[i][1]]);
  return out;
}

export function registerFlourish(): void {
  register({
    name: "copperplate", slot: "flourish", label: "Copperplate flourish", reach: 0.04,
    draw: (pt, rng, b) => {
      const half = copperplateHalf(rng);
      const form = rng.weighted({ mirror: 3, turn: 2 });
      let strokes: Stroke[];
      let extra: Pt[] = [];
      if (form === "mirror") {
        strokes = [{ pts: half, solid: false }, { pts: Pen.mirror(half, 0, -1), solid: false }];
        // Between the halves: a lozenge, alone or between two balls.
        strokes.push({ pts: [[-0.06, 0], [0, 0.12], [0.06, 0], [0, -0.12]], solid: true });
        if (rng.chance(0.5)) extra = [[0, 0.24], [0, -0.24]];
      } else {
        // One stroke through the centre: the left half is the right turned
        // half a turn, written toward the centre, and the whole is levelled.
        const left = Pen.rotate(half, 0, 0);
        const whole: Pt[] = [];
        for (let i = left.length - 1; i >= 1; i--) whole.push(left[i]);
        for (const p of half) whole.push(p);
        strokes = [{ pts: level(whole), solid: false }];
      }
      const ext = Pen.extent(strokes.map((st) => st.pts));
      const [fit, s] = Pen.fit(ext, b, Math.min(b[2] - b[0], b[3] - b[1]) * 0.08);
      const shade = G.clamp(s * 0.03, 0.45, 1.8);
      const polys: Pt[][] = [];
      for (const st of strokes) {
        if (st.solid) polys.push(fit(st.pts));
        else polys.push(Pen.pointed(fit(st.pts), { hair: Math.max(0.16, shade * 0.12), shade, taper: [0.02, 0.08] }));
      }
      const dots: Dot[] = fit(extra).map((p): Dot => [p[0], p[1], shade * 0.9]);
      ink(pt, polys, dots, rng.chance(0.5));
    },
  });

  // The pen swash: an S out of each side of a central lozenge, ending in a
  // curl, shaded where the pen pulls down.
  register({
    name: "swash", slot: "flourish", label: "Pen swash",
    draw: (pt, rng, b) => {
      const [cx, cy, w, h] = K.measure(b);
      const u = w / 2, v = h / 2;
      const lift = rng.range(0.6, 1);
      const wave = rng.range(0.3, 0.5);
      const curl = rng.range(0.85, 1.15);
      const polys: Pt[][] = [];
      for (const d of [-1, 1]) {
        const pts = G.splinePoints(Pen.mirror([[cx + u * 0.04, cy], [cx + u * 0.16, cy + v * 0.5 * lift],
          [cx + u * 0.38, cy - v * wave], [cx + u * 0.62, cy + v * wave * 0.7 * lift], [cx + u * 0.8, cy]], cx, d), 10);
        const tail = K.scroll(pts[pts.length - 1], d > 0 ? -0.4 : PI + 0.4, h * 0.95 * curl, d);
        for (let i = 1; i < tail.length; i++) pts.push(tail[i]);
        polys.push(Pen.pointed(pts, { hair: 0.2, shade: h * 0.035, taper: [0.03, 0.1] }));
      }
      const gilt = rng.chance(0.4);
      polys.push([[cx, cy + v * 0.3], [cx + v * 0.18, cy], [cx, cy - v * 0.3], [cx - v * 0.18, cy]]);
      ink(pt, polys, [[cx - u * 0.94, cy, h * 0.04], [cx + u * 0.94, cy, h * 0.04]], gilt);
    },
  });

  // Swelled rule ----------------------------------------------------------------

  register({
    name: "swelled_rule", slot: "flourish", label: "Swelled rule", reach: 0.02,
    draw: (pt, rng, b) => {
      const [cx, cy, w, h] = K.measure(b);
      const form = rng.weighted({ plain: 2, broken: 3, oxford: 2, triple: 2 });
      const t = h * rng.range(0.11, 0.16);
      const x0 = b[0] + w * 0.04, x1 = b[2] - w * 0.04;
      const paths: Cmd[][] = [];
      let dots: Pt[] = [];
      if (form === "plain") {
        paths.push(G.polyline(lens(x0, x1, cy, t), true));
      } else if (form === "broken") {
        // Two swells meeting a lozenge, with a bead either side of it.
        const s = h * 0.26;
        paths.push(G.polyline(lens(x0, cx - s * 1.5, cy, t), true));
        paths.push(G.polyline(lens(cx + s * 1.5, x1, cy, t), true));
        paths.push(G.smooth(K.lozenge(cx - s * 0.7, cy, s * 1.4, 0), true));
        dots = [[cx - s * 1.15, cy], [cx + s * 1.15, cy]];
      } else if (form === "oxford") {
        // A swell over a hairline, as the thick and thin of an Oxford rule.
        paths.push(G.polyline(lens(x0, x1, cy + t * 0.55, t), true));
        paths.push(G.polyline(lens(x0 + w * 0.06, x1 - w * 0.06, cy - t * 0.75, t * 0.22, 0.3), true));
      } else {
        // A long swell between two short ones, beads in the gaps.
        const g = w * 0.035;
        const side = (x1 - x0) * 0.17;
        paths.push(G.polyline(lens(x0 + side + g, x1 - side - g, cy, t), true));
        paths.push(G.polyline(lens(x0, x0 + side, cy, t * 0.55), true));
        paths.push(G.polyline(lens(x1 - side, x1, cy, t * 0.55), true));
        dots = [[x0 + side + g / 2, cy], [x1 - side - g / 2, cy]];
      }
      Gild.fill(pt, paths, { key: 0.15, shadow: t * 0.12 });
      if (dots.length > 0) Gild.dots(pt, dots, t * 0.3);
    },
  });

  // Fleuronnée ------------------------------------------------------------------

  register({ name: "fleuronnee", slot: "flourish", label: "Fleuronnée penwork", reach: 0.05, draw: fleuronnee });
}

function fleuronnee(this: void, pt: Painter, rng: Rng, b: Box): void {
  const [cx, cy, w, h] = K.measure(b);
  // The two colours of the flourisher's pot, in either role.
  let line: RGB = PAL.ink, accent: RGB = PAL.copper;
  if (rng.chance(0.35)) [line, accent] = [PAL.copper, PAL.ink];
  const hw = G.clamp(h * 0.006, 0.16, 0.3);
  const hairs: Cmd[][] = [], beads: Dot[] = [], rings: Dot[] = [];
  const hair = (pts: readonly Pt[], f: number) => { hairs.push(G.polyline(Pen.hairline(pts, hw, f), true)); };
  const reach = w * 0.47;
  const bud = h * rng.range(0.22, 0.28);
  const n = rng.int(4, 6);
  const turns = rng.range(0.9, 1.25);
  const wave = rng.range(0, 0.05);
  const size = rng.range(0.4, 0.5);
  const gap = h * rng.range(0.05, 0.07);
  for (const d of [-1, 1]) {
    // The spine: a hairline from the bud out to each end, waving
    // slightly, winding into a curl, with an echo along its curl.
    const start: Pt = [cx + d * bud * 1.05, cy];
    const spine = G.splinePoints([start, [cx + d * reach * 0.35, cy + h * wave], [cx + d * reach * 0.7, cy - h * wave],
      [cx + d * reach * 0.84, cy]], 10);
    const curl = Pen.sprig(spine[spine.length - 1], d > 0 ? 0 : PI, h * 0.55, d, turns);
    for (let i = 1; i < curl.length; i++) spine.push(curl[i]);
    hair(spine, 0.6);
    const ce = Pen.echo(curl, -d * gap);
    hair(ce.slice(0, Math.floor(ce.length * 0.7)), 0.3);
    const tip = curl[curl.length - 1];
    rings.push([tip[0], tip[1], h * 0.045]);
    // Sprigs along the spine, turning up and down in turn, each with an
    // echo on its outer side and closing on a pearl; three dots in the
    // gaps between them.
    for (let k = 1; k <= n; k++) {
      const f = 0.06 + (0.68 * (k - 0.5)) / n;
      const [p, along] = G.at(spine, f);
      const side = mod(k, 2) === 1 ? 1 : -1;
      const sp = Pen.sprig(p, along + side * d * 0.85, h * size * rng.range(0.85, 1.1), -side * d, rng.range(0.95, 1.25));
      hair(sp, 0.5);
      const e = Pen.echo(sp, side * d * gap);
      const part: Pt[] = [];
      for (let i = 1; i < Math.floor(e.length * 0.55); i++) part.push(e[i]);
      if (part.length > 2) hair(part, 0.2);
      const q = sp[sp.length - 1];
      rings.push([q[0], q[1], h * 0.035]);
      const m = G.at(spine, f + 0.34 / n)[0];
      const off = -side * h * 0.17;
      for (let j = -1; j <= 1; j++) {
        beads.push([m[0] + j * h * 0.045, m[1] + off + (j === 0 ? -side * h * 0.045 : 0), h * 0.022]);
      }
    }
    // A feather of short hairlines leaving the bud.
    for (const j of [-1, 1]) {
      hair(Pen.sprig([cx + d * bud * 0.9, cy + j * bud * 0.3], (d > 0 ? 0 : PI) + j * d * 0.7, h * 0.3, -j * d, 0.7), 0.4);
    }
  }
  // The bud: a lozenge in the accent, ringed by two echo lines, as the
  // flourisher traced round the initial.
  const core = K.lozenge(cx - bud * 0.6, cy, bud * 1.2, 0);
  for (const sc of [1.4, 1.8]) {
    const e = G.toward(core, cx, cy, sc);
    e.push(e[0]);
    hair(e, 1);
  }
  pt.fillMany(hairs, line, 0.92, { blend: "multiply" });
  const circles = rings.map((r) => G.polyline(Pen.hairline(K.ellipse(r[0], r[1], r[2], r[2], 0, 20), hw), true));
  pt.fillMany(circles, line, 0.92, { blend: "multiply" });
  const dots: Cmd[][] = [];
  for (const q of beads) dots.push(K.dot(q[0], q[1], q[2]));
  for (const r of rings) dots.push(K.dot(r[0], r[1], r[2] * 0.45));
  pt.fillMany(dots, accent, 0.92, { blend: "multiply" });
  pt.fill(G.smooth(core, true), accent, 0.9, { blend: "multiply" });
  pt.fill(K.dot(cx, cy, bud * 0.13), PAL.cream, 0.9);
}
