// Corner pieces after the bookbinder and the flourisher. Each is drawn
// into the lower-left corner of its box (K.corner mirrors it into the
// others):
//   cornerpiece  a quarter of a lobed centre medallion, as tooled in gold
//                on 1580-1620 bindings: a gilt lobed field, interlace and
//                leaf tips tooled into it, a dotted (pointillé) border and
//                double fillets running off along the edges
//   pen_corner   two pen rules meeting in a knot, breaking into fleuronnée
//                curls, pearls and dots in two colours
//   fan          a quarter shell: fine rays out of a rosette hub to a
//                scalloped rim, with a dotted arc between
// The Lua gilt also names a bevel for its raster gold; the vector relief
// sizes its own, so the options here carry only the keyline and shadow.
import { mod } from "#platform";
import type { RGB } from "./color.ts";
import * as G from "./geom.ts";
import type { Cmd, Pt } from "./geom.ts";
import * as Gild from "./orn_gild.ts";
import * as K from "./orn_kit.ts";
import * as Pen from "./orn_pen.ts";
import { register, type Box, type SlotOptions } from "./orn_registry.ts";
import { PAL, type Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

const PI = Math.PI;

// Points along the arc of radius r about c from angle a0 to a1.
function arc(c: Pt, r: number, a0: number, a1: number, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) out.push(G.polar(c, a0 + ((a1 - a0) * k) / n, r));
  return out;
}

function cornerpiece(this: void, pt: Painter, rng: Rng, b: Box, o: SlotOptions): void {
  K.corner(pt, b, o, (x0, y0, s) => {
    const c: Pt = [x0 + s * 0.04, y0 + s * 0.04];
    const R = s * rng.range(0.66, 0.74);
    const lobes = rng.int(2, 3);
    const finial = rng.range(0.1, 0.16);
    // The field's edge: round lobes between inward cusps, and a pointed
    // finial on the diagonal.
    const edge = (t: number, scale: number): Pt => {
      const u = mod(t * (lobes * 2 + 1), 1);
      let r = R * (0.86 + 0.14 * Math.sin(PI * u) ** 0.5);
      r += R * finial * Math.max(0, 1 - Math.abs(t - 0.5) * 9) ** 1.5;
      return G.polar(c, (t * PI) / 2, r * scale);
    };
    // The field is open work, as gold tooled on leather: a gilt band round
    // the lobed edge, and within it a quarter interlace of two arcs, leaf
    // tips on the radii and a fan of small lozenges.
    const band: Pt[] = [];
    for (let k = 0; k <= 120; k++) band.push(edge(k / 120, 1));
    for (let k = 120; k >= 0; k--) band.push(edge(k / 120, 0.86));
    const pieces: Cmd[][] = [G.polyline(band, true)];
    for (const a of [PI / 8, PI / 4, (3 * PI) / 8]) {
      const tip = G.polar(c, a, R * 0.46);
      pieces.push(G.smooth(K.lozenge(tip[0], tip[1], R * (a === PI / 4 ? 0.32 : 0.24), a), true));
    }
    // The hub: a quarter disc with a scalloped rim.
    const hub: Pt[] = [c];
    for (let k = 0; k <= 48; k++) {
      const t = k / 48;
      hub.push(G.polar(c, (t * PI) / 2, R * (0.2 + 0.03 * Math.sin(PI * mod(t * 4, 1)) ** 0.6)));
    }
    pieces.push(G.polyline(hub, true));
    Gild.fill(pt, pieces, { key: 0.18, shadow: s * 0.006 });
    const rings = [0.36, 0.42].map((r) => G.smooth(arc(c, R * r, 0.02, PI / 2 - 0.02), false));
    Gild.line(pt, rings, G.clamp(s * 0.007, 0.18, 0.45));
    // Pointillé: dots inside the band and just outside the edge.
    const dots: Pt[] = [];
    const m = lobes * 12;
    for (let k = 1; k <= m - 1; k++) dots.push(edge(k / m, 1.07));
    Gild.dots(pt, dots, s * 0.009);
    const inner: Pt[] = [];
    for (let k = 1; k <= m - 1; k += 2) inner.push(edge(k / m, 0.78));
    Gild.dots(pt, inner, s * 0.008);
    // Double fillets off along each edge, ending in a small leaf.
    const lines: Cmd[][] = [];
    for (const d of [0.012, 0.035]) {
      lines.push(G.polyline([[c[0] + R * 0.95, y0 + s * d], [x0 + s * 0.98, y0 + s * d]], false));
      lines.push(G.polyline([[x0 + s * d, c[1] + R * 0.95], [x0 + s * d, y0 + s * 0.98]], false));
    }
    Gild.line(pt, lines, G.clamp(s * 0.008, 0.2, 0.5));
    const spokes: Cmd[][] = [];
    for (let k = 1; k <= 3; k++) spokes.push(G.polyline([G.polar(c, (k * PI) / 8, R * 0.05), G.polar(c, (k * PI) / 8, R * 0.17)], false));
    pt.strokeMany(spokes, Gild.UMBER, G.clamp(s * 0.005, 0.12, 0.3), 0.6);
  });
}

// A dot to paint: centre and radius.
type Dot = readonly [number, number, number];

function penCorner(this: void, pt: Painter, rng: Rng, b: Box, o: SlotOptions): void {
  K.corner(pt, b, o, (x0, y0, s) => {
    let line: RGB = PAL.ink, accent: RGB = PAL.copper;
    if (rng.chance(0.35)) [line, accent] = [PAL.copper, PAL.ink];
    const hw = G.clamp(s * 0.004, 0.15, 0.28);
    const hairs: Cmd[][] = [], beads: Dot[] = [], rings: Dot[] = [];
    const hair = (pts: readonly Pt[], f: number) => { hairs.push(G.polyline(Pen.hairline(pts, hw, f), true)); };
    const k0 = s * 0.1;
    // A thick and a thin rule along each edge, from the knot out.
    const rules: Pt[][] = [];
    for (const e of [[1, 0], [0, 1]] as const) {
      const at = (t: number, off: number): Pt => [x0 + e[0] * t + e[1] * off, y0 + e[1] * t + e[0] * off];
      rules.push(Pen.hairline([at(k0 * 1.3, k0 * 0.5), at(s * 0.92, k0 * 0.5)], hw * 2.6, 0.2));
      hair([at(k0 * 1.3, k0 * 0.8), at(s * 0.8, k0 * 0.8)], 0.4);
      // Sprigs off the rule's inner side, turning in toward the page.
      const n = rng.int(2, 3);
      for (let k = 1; k <= n; k++) {
        const t = k0 * 1.5 + ((s * 0.7 - k0 * 1.5) * (k - 0.5)) / n;
        const p = at(t, k0 * 0.8);
        const away = Math.atan2(e[0], e[1]);
        const dir = e[0] === 1 ? 1 : -1;
        const sp = Pen.sprig(p, away + dir * 0.6, s * rng.range(0.28, 0.34), -dir, rng.range(0.9, 1.2));
        hair(sp, 0.5);
        const e2 = Pen.echo(sp, -dir * s * 0.025);
        const part: Pt[] = [];
        for (let i = 1; i < Math.floor(e2.length * 0.5); i++) part.push(e2[i]);
        if (part.length > 2) hair(part, 0.2);
        const q = sp[sp.length - 1];
        rings.push([q[0], q[1], s * 0.018]);
        const m = at(t + s * 0.08, k0 * 0.8 + s * 0.06);
        beads.push([m[0], m[1], s * 0.012]);
      }
      // The rule's end breaks into a curl.
      const tipdir = e[0] === 1 ? 0 : PI / 2;
      hair(Pen.sprig(at(s * 0.8, k0 * 0.8), tipdir, s * 0.2, e[0] === 1 ? 1 : -1, 1.1), 0.5);
    }
    // The knot: a lozenge on the corner, ringed by echo lines, with a
    // diagonal sprig into the page and three dots beyond it.
    const core = K.lozenge(x0 + k0 * 0.2, y0 + k0 * 0.2, k0 * 1.1, PI / 4);
    const mid = G.centroid(core);
    for (const sc of [1.45, 1.9]) {
      const e = G.toward(core, mid[0], mid[1], sc);
      e.push(e[0]);
      hair(e, 1);
    }
    for (const d of [-1, 1]) {
      const sp = Pen.sprig(G.polar(mid, PI / 4, k0 * 1.3), PI / 4 + d * 0.35, s * 0.3, -d, rng.range(1.0, 1.3));
      hair(sp, 0.5);
      const q = sp[sp.length - 1];
      rings.push([q[0], q[1], s * 0.02]);
    }
    const far = G.polar(mid, PI / 4, s * 0.48);
    for (let j = -1; j <= 1; j++) {
      const q = G.polar(far, PI / 4 + PI / 2, j * s * 0.03);
      beads.push([q[0] + (j === 0 ? s * 0.02 : 0), q[1] + (j === 0 ? s * 0.02 : 0), s * 0.013]);
    }
    pt.fill(G.polyline(rules[0], true), line, 0.9, { blend: "multiply" });
    pt.fill(G.polyline(rules[1], true), line, 0.9, { blend: "multiply" });
    pt.fillMany(hairs, line, 0.92, { blend: "multiply" });
    const circles: Cmd[][] = [], dots: Cmd[][] = [];
    for (const r of rings) {
      circles.push(G.polyline(Pen.hairline(K.ellipse(r[0], r[1], r[2], r[2], 0, 16), hw), true));
      dots.push(K.dot(r[0], r[1], r[2] * 0.45));
    }
    for (const q of beads) dots.push(K.dot(q[0], q[1], q[2]));
    pt.fillMany(circles, line, 0.92, { blend: "multiply" });
    pt.fillMany(dots, accent, 0.92, { blend: "multiply" });
    pt.fill(G.smooth(core, true), accent, 0.9, { blend: "multiply" });
  });
}

function fan(this: void, pt: Painter, rng: Rng, b: Box, o: SlotOptions): void {
  K.corner(pt, b, o, (x0, y0, s) => {
    const c: Pt = [x0 + s * 0.04, y0 + s * 0.04];
    const n = rng.int(5, 7) * 2;
    const rim = s * 0.8;
    const inner = rim * rng.range(0.8, 0.84);
    const step = PI / 2 / n;
    // The rim: a scallop between each pair of long rays, bulging out from
    // the inner arc, as one gilt band.
    const band: Pt[] = [];
    for (let k = 0; k < n; k++) {
      const a0 = k * step, a1 = (k + 1) * step;
      for (let j = 0; j <= 10; j++) {
        const t = j / 10;
        band.push(G.polar(c, a0 + (a1 - a0) * t, rim * (0.95 + 0.06 * Math.sin(PI * t) ** 0.7)));
      }
    }
    for (let k = 40; k >= 0; k--) band.push(G.polar(c, ((k / 40) * PI) / 2, inner * 1.04));
    Gild.fill(pt, [G.polyline(band, true)], { key: 0.18, shadow: s * 0.006 });
    // Rays from the hub to the rim's inner edge, long and short in turn,
    // each a slim gilt spindle; the short ones stop at a dotted arc.
    const rays: Cmd[][] = [];
    const dotR = inner * 0.78;
    for (let k = 0; k <= n * 2; k++) {
      const a = (k * step) / 2;
      const long = mod(k, 2) === 0;
      const r1 = long ? inner * 1.02 : dotR * 0.94;
      const half = (long ? 0.5 : 0.36) * step * s * 0.18;
      const base = G.polar(c, a, s * 0.16);
      const tip = G.polar(c, a, r1);
      const mid = G.polar(c, a, s * 0.16 + (r1 - s * 0.16) * 0.35);
      rays.push(G.smooth([base, G.polar(mid, a + PI / 2, half), tip, G.polar(mid, a - PI / 2, half)], true, 0.8));
    }
    Gild.fill(pt, rays, { key: 0.1, shadow: 0 });
    const dots: Pt[] = [];
    for (let k = 0; k < n; k++) dots.push(G.polar(c, (k + 0.5) * step, dotR));
    Gild.dots(pt, dots, s * 0.014);
    // A fine arc inside the rim and the hub: a half rosette.
    Gild.line(pt, [G.smooth(arc(c, inner * 0.97, 0, PI / 2, 30), false)], G.clamp(s * 0.004, 0.15, 0.3));
    const hub = arc(c, s * 0.17, 0, PI / 2, 20);
    hub.unshift(c);
    Gild.fill(pt, [G.polyline(hub, true)], { key: 0.15, shadow: 0 });
    pt.stroke(G.smooth(arc(c, s * 0.11, 0.05, PI / 2 - 0.05, 12), false), Gild.UMBER, 0.25, 0.6);
    pt.fill(K.dot(c[0], c[1], s * 0.05), PAL.copper, 0.95);
  });
}

export function registerCorner(): void {
  register({ name: "cornerpiece", slot: "corner", label: "Binding cornerpiece", reach: 0.03, draw: cornerpiece });
  register({ name: "pen_corner", slot: "corner", label: "Penwork corner", reach: 0.05, draw: penCorner });
  register({ name: "fan", slot: "corner", label: "Quarter fan", reach: 0.03, draw: fan });
}
