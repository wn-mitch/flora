// Scenes the engine's tests and tests/agreement.ts grow, and every number
// one holds, for comparing scenes number by number.
import * as F from "../../src/engine/flower.ts";
import { leaf, leaflets, options } from "../../src/engine/leaf.ts";
import * as S from "../../src/engine/sprig.ts";
import * as GR from "../../src/engine/grow.ts";
import * as LA from "../../src/engine/layout.ts";
import * as MX from "../../src/engine/mix.ts";
import type { Space } from "../../src/engine/space.ts";
import { Painter, type Scene, type SceneItem } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";

export function grow(seed: string, len = 110, ang = 1.3): Scene {
  const pt = new Painter({ width: 240, height: 320 });
  const r = new Rng(seed);
  leaf(pt, r, 120, 40, ang, options(r, len, ang));
  return pt.scene();
}

// A bloom of each kind on one page: a styled bloom, the tilted hero, a
// lily seen at an angle, a bud and a few florets.
export function blooms(seed: string, style: string): Scene {
  const pt = new Painter({ width: 300, height: 300 });
  const r = new Rng(seed);
  F.bloom(pt, r.fork("bloom"), 80, 80, 36, { style });
  F.hero(pt, r.fork("hero"), 200, 200, 50);
  F.tilted(pt, r.fork("lily"), 80, 220, 30, 2.1, 1.0, { kind: "lance", petals: 6, width: 0.36 });
  F.bud(pt, 220, 60, 0.7, 14);
  F.florets(pt, [{ x: 150, y: 40, r: 2, rot: 0.3, tint: 1 }, { x: 160, y: 44, r: 0.8, tint: 3 }, { x: 170, y: 40, r: 1.6, soft: true }]);
  return pt.scene();
}

// Sprays on one page: an umbel, a cyme, baby's breath, a stem with
// leaflets and a flourish, batched and painted together.
export function sprays(seed: string): Scene {
  const pt = new Painter({ width: 300, height: 300 });
  const r = new Rng(seed);
  const b = new S.Batch();
  S.umbel(b, r.fork("umbel"), [80, 60], 1.5, 50);
  S.cyme(b, r.fork("cyme"), [200, 60], 1.2, 60, 1);
  S.gypsophila(b, r.fork("gyps"), [150, 150], 1.7, 34, 4);
  const stem = S.flourish([40, 200], 0.4, 120, -1);
  b.stem(stem, 1.4, 0.4);
  leaflets(pt, r.fork("leaflets"), S.leafletItems(r.fork("items"), stem, [18, 28], 14));
  b.paint(pt);
  return pt.scene();
}

// A body page's text: 48 lines, the last one short.
export function bodySpec(): LA.PageSpec {
  const lines: LA.Box[] = [];
  for (let i = 0; i < 48; i++) lines.push({ x0: 162, x1: i === 47 ? 300 : 436, y0: 712 - 12 * i, y1: 720 - 12 * i });
  return { width: 595, height: 842, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
}

// A page's growth as compose runs it, without the ornaments: the region,
// the stems round a cartouche's place, then leaves, tips, holes and
// details.
export function growPage(seed: string, mix?: MX.Mix): [Space, GR.GrowContext] {
  const spec = bodySpec();
  const hero = [84.5, 606, 68.5] as const;
  const [g, m] = LA.region(spec);
  g.field();
  const gest = LA.gesture(new Rng(seed).fork("gesture"), m, hero);
  const [strands] = LA.strands(new Rng(seed).fork("strands"), m, hero, spec.width, gest, [16, 300, 66, 370]);
  for (const st of strands) g.reserveLine(st.pts, 2, 4);
  const ctx: GR.GrowContext = {
    cfg: MX.cfg(undefined, mix), mix, mw: m.x1 - m.x0, dens: MX.density(gest.density, mix), ylo: m.y0, span: hero[1] - m.y0,
    strands, stems: strands, stemBatch: new S.Batch(), sprays: new S.Batch(), blooms: [], back: [], leaves: [], leaflets: [], counts: {},
  };
  const r = new Rng(seed).fork("grow");
  GR.nodeLeaves(g, r.fork("nodes"), strands, ctx);
  GR.tips(g, r.fork("tips"), strands, ctx);
  GR.holes(g, r.fork("holes"), ctx);
  GR.details(g, r.fork("details"), ctx);
  return [g, ctx];
}

// Every number a scene holds, in painting order.
export function numbers(items: readonly SceneItem[], out: number[] = []): number[] {
  for (const it of items) {
    for (const v of it.path.verbs) out.push(v);
    for (const c of it.path.coords) out.push(c);
    if (it.kind === "clip") {
      numbers(it.items, out);
    } else {
      out.push(it.alpha);
      if (it.kind === "stroke") out.push(it.width, it.rgb[0], it.rgb[1], it.rgb[2]);
      else if (it.paint.kind === "solid") out.push(it.paint.rgb[0], it.paint.rgb[1], it.paint.rgb[2]);
      else {
        out.push(it.paint.from[0], it.paint.from[1], it.paint.to[0], it.paint.to[1]);
        for (const s of it.paint.stops) out.push(s[0], s[1][0], s[1][1], s[1][2]);
      }
    }
  }
  return out;
}
