// Spray helpers for grow.ts: a spray grown on a stalk from a stem point,
// and a check that it clears the text.
import * as G from "./geom.ts";
import type { Pt } from "./geom.ts";
import type { Rng } from "./rng.ts";
import * as S from "./sprig.ts";
import type { Space } from "./space.ts";

const PI = Math.PI;

// Nearest point on any stem within `maxd` (every other point of each),
// its distance and that stem's tangent there; undefined beyond maxd.
export function nearest(stems: readonly { readonly pts: readonly Pt[] }[], p: Pt, maxd: number): [Pt, number, number] | undefined {
  let best: Pt | undefined, bd = maxd, ba = 0;
  for (const s of stems) {
    const pts = s.pts;
    for (let i = 1; i < pts.length; i += 2) {
      const d = G.dist(p, pts[i]);
      if (d < bd) {
        best = pts[i];
        bd = d;
        ba = G.angle(pts[i - 1], pts[i]);
      }
    }
  }
  return best === undefined ? undefined : [best, bd, ba];
}

// What a spray may be: a bloom's stalk, baby's breath, a cyme, an umbel,
// three buds, or a single floret.
export type SprayKind = "bloom" | "gyps" | "cyme" | "umbel" | "bud" | "floret";

// Grow one spray of `kind` toward (x, y) from stem point s, d pt away, whose
// stem runs along `tangent`, into batch `b`. The stalk peels off the stem
// tangentially and sweeps into the gap; the spray continues its heading.
// `scale` shrinks the spray; `lean` turns it. Returns the stalk.
export function grow(b: S.Batch, rng: Rng, kind: string, s: Pt, tangent: number, d: number, x: number, y: number, r: number, scale: number, lean: number): Pt[] {
  const target: Pt = [x, y];
  const chord = G.angle(s, target);
  const dir0 = G.depart(s, tangent, target, 0.35);
  const a = chord + G.turn(chord, dir0) * 0.6 + lean;
  const base = G.polar(s, chord, Math.max(d - r * 0.55, 3));
  const stalk = G.link(s, dir0, base, a);
  b.line(stalk, d > 30 ? 2 : 3);
  r = r * scale;
  if (kind === "bloom") {
    b.line(G.splinePoints([base, target], 2), 2);
  } else if (kind === "gyps") {
    S.gypsophila(b, rng, base, a, r * 0.5, r >= 14 ? 5 : r >= 8 ? 4 : 3);
  } else if (kind === "cyme") {
    S.cyme(b, rng, base, a, r * 1.25, rng.chance(0.5) ? 1 : -1);
  } else if (kind === "umbel") {
    S.umbel(b, rng, base, a, r * 0.85);
  } else if (kind === "bud") {
    for (let k = -1; k <= 1; k++) {
      const stem = G.curve(base, a + k * 0.45, r * 0.6, rng.jit(0.4), 0, 4);
      b.line(stem, 3);
      const e = stem[stem.length - 1];
      b.bud(e[0], e[1], a + k * 0.45, r * 0.32);
    }
  } else {
    b.floret(x, y, r * 0.35, rng.range(0, 2 * PI), rng.int(1, 3) as 1 | 2 | 3);
  }
  return stalk;
}

// Does every point of batch `b` lie in open space, with its radius?
export function fits(g: Space, b: S.Batch): boolean {
  let ok = true;
  b.eachPoint((x, y, r) => {
    if (ok && !(g.openAt(x, y) && g.openAt(x - r, y) && g.openAt(x + r, y) && g.openAt(x, y - r) && g.openAt(x, y + r))) ok = false;
  });
  return ok;
}
