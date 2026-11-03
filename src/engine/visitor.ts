// Visitors to the border: a bee on a dotted flight path, a butterfly, a
// songbird perched on its own twig and a snail climbing the main stem.
// They follow Kevin Raymond's florilegium (github.com/kevinraymond/
// florilegium), drawn here in this package's washes and pen work.
//
// How many come is the page's mix (mix.ts): each visitor's weight scales
// its chance per page. They are placed after the leaves and before the
// holes fill, on their own random stream, and nothing is touched when every
// visitor's weight is 0, so such a page is exactly a page without them.
import { fmt, mod } from "#platform";
import * as C from "./color.ts";
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import type { GrowContext, Placed, StemLike } from "./grow.ts";
import * as M from "./mix.ts";
import { PAL, type Painter, type PaintOptions } from "./paint.ts";
import type { Rng } from "./rng.ts";
import type { Space } from "./space.ts";
import * as W from "./wash.ts";

const PI = Math.PI;
const MULT: PaintOptions = { blend: "multiply" };

// A visitor's chance per page at weight 1, the most per page, and the
// radius it needs clear around it (pt).
export interface Kind {
  readonly chance: number;
  readonly most: number;
  readonly room: number;
}

export const KINDS: Readonly<Record<string, Kind>> = {
  bee: { chance: 0.6, most: 3, room: 14 },
  butterfly: { chance: 0.7, most: 3, room: 20 },
  bird: { chance: 0.5, most: 1, room: 28 },
  snail: { chance: 0.45, most: 1, room: 12 },
};

// An ellipse of radii rx, ry around (cx, cy), as a polygon of n points.
function ellipse(cx: number, cy: number, rx: number, ry: number, n = 18): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * PI * i) / n;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

function posed(pts: readonly Pt[], x: number, y: number, ang: number, s: number): Pt[] {
  return G.transform(pts, x, y, ang, s, s);
}

// An ink hairline through pts.
function hair(pt: Painter, pts: readonly Pt[], w: number, op = 0.85): void {
  pt.stroke(G.polyline(pts, false), PAL.ink, w, op, MULT);
}

const dot = (p: Pt, r: number): G.Cmd[] => [["o", p[0], p[1], r]];

// A bee at (x, y) heading `ang`, about `L` pt long.
export function bee(pt: Painter, rng: Rng, x: number, y: number, ang: number, L: number): void {
  const s = L / 13;
  const at = (pts: readonly Pt[]) => posed(pts, x, y, ang, s);
  // Wings first, so the body lies over their roots: pale and glassy.
  for (const w of [[1.5, 4.2, 0.55], [-0.5, 3.6, 0.95]]) {
    const wing = G.smooth(at(G.transform(ellipse(0, 0, 4.4, 2.0), w[0], w[1], w[2])), true);
    pt.fill(wing, PAL.white, 0.75);
    pt.fill(wing, PAL.sky, 0.10, MULT);
    pt.stroke(wing, PAL.ink, 0.25 * s, 0.55, MULT);
  }
  // Legs under the thorax.
  for (let k = -1; k <= 1; k++) {
    hair(pt, at([[1.8 + k * 1.2, -1.6], [1.2 + k * 1.6, -3.4], [0.6 + k * 1.8, -4.2]]), 0.3 * s);
  }
  // The abdomen: a gold wash crossed by ink bands.
  const abd = at(ellipse(-2.6, 0, 4.8, 3.2));
  W.wash(pt, abd, {
    rng, size: 6 * s, pigment: PAL.gold, pool: PAL.copper,
    simple: true, rings: 5, lift: 0.12, grain: 0.4, outline: 0.6, outline_w: 0.3 * s,
  });
  pt.clipBegin(G.smooth(abd, true));
  for (const bx of [-4.6, -2.4, -0.2]) {
    pt.stroke(G.polyline(at([[bx + 0.4, -4], [bx - 0.4, 4]]), false), PAL.ink, 1.1 * s, 0.8, MULT);
  }
  pt.clipEnd();
  hair(pt, at([[-7.4, 0], [-8.6, -0.3]]), 0.4 * s);
  // Thorax and head in ink, with antennae.
  pt.fill(G.smooth(at(ellipse(2.3, 0, 2.6, 2.4)), true), PAL.ink, 0.85, MULT);
  pt.fill(G.smooth(at(ellipse(5.2, 0.2, 1.7, 1.6)), true), PAL.ink, 0.9, MULT);
  hair(pt, at([[6.2, 1.2], [7.6, 2.8], [8.8, 3.1]]), 0.25 * s);
  hair(pt, at([[6.3, 0.8], [8.0, 1.8], [9.1, 1.6]]), 0.25 * s);
}

// The bee's dotted flight path: a loop behind it, ending at its tail.
// Points must satisfy ok(x, y); the path stops at the first that does not.
export function trail(rng: Rng, x: number, y: number, ang: number, L: number, ok: (this: void, x: number, y: number) => boolean): Pt[] {
  const pts: Pt[] = [];
  const turn = rng.chance(0.5) ? 1 : -1;
  const loopAt = rng.range(0.35, 0.6);
  const n = 70;
  const back = ang + PI;
  let px = x + Math.cos(back) * L * 0.6, py = y + Math.sin(back) * L * 0.6;
  let h = back + turn * rng.range(-0.3, 0.3);
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    // A gentle wander with one full loop partway.
    const k = 0.04 * Math.sin(u * 7) + (Math.abs(u - loopAt) < 0.12 ? turn * 0.55 : 0);
    h += k;
    px += Math.cos(h) * 2.2;
    py += Math.sin(h) * 2.2;
    if (!ok(px, py)) break;
    pts.push([px, py]);
  }
  return pts;
}

// The flight path as ink dots, every other point.
export function paintTrail(pt: Painter, pts: readonly Pt[]): void {
  for (let i = 0; i < pts.length; i += 2) pt.fill(dot(pts[i], 0.6), PAL.ink, 0.6, MULT);
}

// One wing from the body's root: points in units of the span, right side.
const FORE: readonly Pt[] = [[0, 1], [4, 7], [10, 12], [14, 12.5], [14.5, 8.5], [10, 3.5], [3, 0.5]];
const HIND: readonly Pt[] = [[0, -0.5], [6, -1.5], [10.5, -5], [9, -10.5], [4, -11], [1, -6]];

// A butterfly at (x, y), body along `ang` (head forward), wings open by
// `open` (1 flat open, toward 0 folded), about `S` pt across.
export function butterfly(pt: Painter, rng: Rng, x: number, y: number, ang: number, S: number, open: number): void {
  const s = S / 29;
  const rot = ang - PI / 2;
  const ink = C.inkFor(rng, rng.pick(["blue", "violet", "teal"]));
  for (const side of [1, -1]) {
    const shapes = [HIND, FORE];
    for (let wi = 1; wi <= 2; wi++) {
      const shape = shapes[wi - 1];
      const poly = posed(shape.map((p): Pt => [side * p[0] * open, p[1]]), x, y, rot, s);
      // The wing's outer tip: its fourth point, on either wing.
      const tp = shape[3];
      const tip = posed([[side * tp[0] * open, tp[1]]], x, y, rot, s)[0];
      W.wash(pt, poly, {
        rng: rng.fork("wing" + fmt(side, 0) + fmt(wi, 0)), size: 12 * s,
        ramp: "vivid", part: "blooms", axis: [[x, y], tip],
        pigment: ink !== undefined ? C.inkRgb(ink, 0.5) : PAL.blue, pool: PAL.deep,
        simple: true, outline: 0.55, outline_w: 0.3 * s, grain: 0.15,
      });
      // Pale eyespots near the wing's outer edge.
      const c = posed([[side * (tp[0] - 3) * open, tp[1] - 1.5]], x, y, rot, s)[0];
      pt.fill(dot(c, 1.1 * s), PAL.white, 0.8);
    }
  }
  const body = posed(ellipse(0, -1, 1.1, 7), x, y, rot, s);
  pt.fill(G.smooth(body, true), PAL.ink, 0.85, MULT);
  for (const side of [1, -1]) {
    const a = posed([[0, 5.5], [side * 2.5, 10], [side * 4, 12.5]], x, y, rot, s);
    hair(pt, a, 0.3 * s);
    pt.fill(dot(a[2], 0.6 * s), PAL.ink, 0.85, MULT);
  }
}

// A songbird in profile perched at (x, y) (its feet), facing right when
// dir is 1 and left when -1, about `L` pt from tail to beak.
const BIRD: readonly Pt[] = [[-17, -1], [-13, 1.5], [-6, 6.5], [2, 8.5], [8, 12], [12, 12.5], [15, 10],
  [14.5, 6.5], [11, 3], [7, -2.5], [0, -6], [-6, -5.5], [-12, -2.5]];
const WING: readonly Pt[] = [[-11, 1], [-4, 6], [4, 6.5], [7, 2.5], [0, -1.5], [-7, -1]];

export function bird(pt: Painter, rng: Rng, x: number, y: number, dir: number, L: number): void {
  const s = L / 32;
  const at = (pts: readonly Pt[]) => pts.map((p): Pt => [x + dir * p[0] * s, y + (p[1] + 9) * s]);
  // Legs and toes gripping the twig.
  for (const lx of [-1.5, 1.5]) {
    hair(pt, at([[lx, -5.5], [lx + 0.5, -8], [lx, -9]]), 0.45 * s);
    hair(pt, at([[lx - 1.6, -9], [lx + 1.8, -9]]), 0.4 * s);
  }
  const ink = C.inkFor(rng, rng.pick(["blue", "blue-grey", "teal"]));
  W.wash(pt, at(BIRD), {
    rng: rng.fork("body"), size: 18 * s, ramp: "soft", part: "blooms",
    axis: [at([[6, -4]])[0], at([[-4, 8]])[0]],
    pigment: ink !== undefined ? C.inkRgb(ink, 0.55) : PAL.blue, pool: PAL.deep,
    simple: true, outline: 0.6, outline_w: 0.35 * s, grain: 0.12,
  });
  W.wash(pt, at(WING), {
    rng: rng.fork("wing"), size: 12 * s, ramp: "vivid", part: "blooms",
    axis: [at([[5, 3]])[0], at([[-11, 1]])[0]],
    pigment: PAL.blue, pool: PAL.deep, simple: true, outline: 0.5, outline_w: 0.3 * s,
  });
  // Feather lines along the wing.
  for (let k = 0; k <= 2; k++) {
    hair(pt, at([[3 - k * 2, 4 - k * 1.2], [-4 - k * 2, 3 - k * 1.5], [-9 - k, 0.5 - k * 0.6]]), 0.2 * s, 0.5);
  }
  // Beak, eye.
  const beak = G.polyline(at([[14.6, 10.5], [19.5, 9.2], [14.6, 8]]), true);
  pt.fill(beak, PAL.gold, 0.9, MULT);
  pt.stroke(beak, PAL.ink, 0.25 * s, 0.8, MULT);
  const eye = at([[11.4, 9.6]])[0];
  pt.fill(dot(eye, 0.95 * s), PAL.ink, 0.95, MULT);
  pt.fill(dot([eye[0] + dir * 0.3 * s, eye[1] + 0.3 * s], 0.3 * s), PAL.white, 0.9);
}

// A snail at (x, y) on a stem heading `ang`, its shell to side `side`
// (1 left of the heading, -1 right), about `L` pt long.
export function snail(pt: Painter, rng: Rng, x: number, y: number, ang: number, side: number, L: number): void {
  const s = L / 18;
  const at = (pts: readonly Pt[]) => G.transform(pts, x, y, ang, s, s * side);
  const foot = at([[-9, 0.4], [-4, 2.2], [4, 2.6], [8, 3.4], [10, 2.6], [9.5, 0.8], [4, 0.2], [-4, -0.2]]);
  W.wash(pt, foot, {
    rng: rng.fork("foot"), size: 8 * s, pigment: PAL.mist, pool: PAL.sky,
    simple: true, rings: 4, lift: 0.1, outline: 0.5, outline_w: 0.25 * s,
  });
  for (const t of [[9, 3], [9.8, 2.6]] as Pt[]) {
    const tip: Pt = [t[0] + 2.4, t[1] + 3.2];
    hair(pt, at([t, [t[0] + 1.2, t[1] + 1.8], tip]), 0.3 * s);
    pt.fill(dot(at([tip])[0], 0.45 * s), PAL.ink, 0.85, MULT);
  }
  const earth = C.inkFor(rng, rng.pick(["earth", "gold", "warm"]));
  W.wash(pt, at(ellipse(-1, 7, 6.2, 5.8, 22)), {
    rng: rng.fork("shell"), size: 9 * s, ramp: "soft", part: "leaves",
    axis: [at([[1, 10]])[0], at([[-4, 3]])[0]],
    pigment: earth !== undefined ? C.inkRgb(earth, 0.55) : PAL.gold, pool: PAL.copper,
    simple: true, outline: 0.6, outline_w: 0.3 * s, grain: 0.25,
  });
  // The whorl.
  const spiral: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * 2.6 * PI;
    const r = 5.4 * (1 - i / 46);
    spiral.push([-1 + r * Math.cos(a + 0.6), 7 + r * Math.sin(a + 0.6)]);
  }
  hair(pt, at(spiral), 0.35 * s, 0.7);
}

// How many of `kind` come to a page with mix weight w: the whole part of
// chance * w, one more with the fractional part's chance, at most `most`.
function count(rng: Rng, kind: string, w: number): number {
  const k = KINDS[kind];
  const e = k.chance * w;
  let n = Math.floor(e);
  if (rng.next() < e - n) n++;
  return Math.min(n, k.most);
}

// Open cells with at least `need` clearance, as [x, y, room].
function openSpots(g: Space, need: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const f = g.f;
  if (f === undefined) throw new Error("visitor: the space needs field() first");
  const nx = g.nx, c = g.c;
  for (let k = 0; k < g.nx * g.ny; k++) {
    if (f[k] >= need) out.push([(mod(k, nx) + 0.5) * c, (Math.floor(k / nx) + 0.5) * c, f[k]]);
  }
  return out;
}

// Place the page's visitors on space g (with its field built). Their
// painters go to ctx.visitors, each with where it stands; ctx.mix is the
// page's mix; strands are the plant's stems, the main one first. A bird's
// twig goes to ctx.stemBatch, and ctx.counts records how many of each kind
// came. Returns at once, touching nothing, when no visitor has weight.
export function place(g: Space, rng: Rng, ctx: GrowContext, strands: readonly StemLike[]): void {
  const want: Record<string, number> = {};
  let any = false;
  for (const kind of M.VISITORS) {
    const w = M.weight(ctx.mix, kind);
    want[kind] = w > 0 ? count(rng.fork(kind), kind, w) : 0;
    any = any || want[kind] > 0;
  }
  if (!any) return;
  const visitors = ctx.visitors ?? [];
  ctx.visitors = visitors;
  const placed: Record<string, number> = {};
  const add = (kind: string, paint: Placed["paint"], x: number, y: number) => {
    visitors.push({ paint, at: [x, y] });
    placed[kind] = (placed[kind] ?? 0) + 1;
  };
  const main = strands.length > 0 ? strands[0] : undefined;

  // The snail climbs the main stem, low down, on the side with more room.
  if (want.snail > 0 && main !== undefined) {
    const r = rng.fork("snail");
    for (let n = 0; n < 8; n++) {
      const t = r.range(0.15, 0.45);
      const [p, a] = G.at(main.pts, t);
      const L = r.range(26, 31);
      let best = -1, side = 1;
      for (const sd of [1, -1]) {
        const q = G.polar(p, a + (sd * PI) / 2, L * 0.45);
        const rm = g.room(q[0], q[1]);
        if (rm > best) {
          best = rm;
          side = sd;
        }
      }
      if (best >= KINDS.snail.room * 0.6) {
        const c = G.polar(p, a + (side * PI) / 2, L * 0.4);
        g.disc(c[0], c[1], L * 0.55, 1);
        const fr = r.fork("paint");
        add("snail", (pt) => snail(pt, fr, p[0], p[1], a, side, L), p[0], p[1]);
        break;
      }
    }
  }

  // The bird perches at the end of its own twig from one of the stems,
  // the main one first, where there is room for it.
  if (want.bird > 0 && main !== undefined) {
    const r = rng.fork("bird");
    for (let attempt = 1; attempt <= 40; attempt++) {
      const st = attempt <= 15 ? main : strands[r.int(1, strands.length) - 1];
      const t = r.range(0.25, 0.75);
      const [p, a] = G.at(st.pts, t);
      const sd = r.chance(0.5) ? 1 : -1;
      const out = a + sd * r.range(0.7, 1.1);
      const len = r.range(22, 34);
      const tip = G.polar(p, out, len);
      const L = r.range(40, 50);
      const body: Pt = [tip[0], tip[1] + L * 0.35];
      if (g.room(body[0], body[1]) >= L * 0.38 && g.openAt(tip[0], tip[1])) {
        const twig = G.link(p, a, tip, out + sd * 0.4, 0.5);
        let clear = true;
        for (let i = 1; i < twig.length; i++) if (!g.openAt(twig[i][0], twig[i][1])) clear = false;
        if (clear) {
          ctx.stemBatch.stem(twig, 0.9, 0.5);
          g.reserveLine(twig, 2, 4);
          g.disc(body[0], body[1], L * 0.5, 1);
          const dir = Math.cos(out) >= 0 ? 1 : -1;
          const fr = r.fork("paint");
          add("bird", (pt) => bird(pt, fr, tip[0], tip[1], dir, L), tip[0], tip[1]);
          break;
        }
      }
    }
  }

  // Bees and butterflies take open spaces away from the stems.
  for (const kind of ["butterfly", "bee"]) {
    const r = rng.fork(kind + " place");
    for (let n = 1; n <= want[kind]; n++) {
      const spots = openSpots(g, KINDS[kind].room);
      if (spots.length === 0) break;
      const sp = spots[r.int(1, spots.length) - 1];
      const x = sp[0], y = sp[1];
      const fr = r.fork(kind + fmt(n, 0));
      if (kind === "butterfly") {
        const S = Math.min(sp[2] * 1.7, r.range(32, 42));
        const ang = PI / 2 + r.range(-0.7, 0.7);
        const open = r.range(0.7, 1);
        g.disc(x, y, S * 0.55, 1);
        add(kind, (pt) => butterfly(pt, fr, x, y, ang, S, open), x, y);
      } else {
        const L = r.range(16, 20);
        const ang = r.range(0, 2 * PI);
        g.disc(x, y, L * 0.7, 1);
        const path = trail(fr.fork("trail"), x, y, ang, L, (px, py) => g.free(px, py));
        if (path.length > 4) g.reserveLine(path, 1.2, 4);
        add(kind, (pt) => {
          paintTrail(pt, path);
          bee(pt, fr, x, y, ang, L);
        }, x, y);
      }
    }
  }
  for (const k of M.VISITORS) if (placed[k] !== undefined) ctx.counts[k] = placed[k];
}
