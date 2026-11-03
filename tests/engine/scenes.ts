// Scenes the engine's tests and tests/agreement.ts grow, and every number
// one holds, for comparing scenes number by number.
import { leaf, options } from "../../src/engine/leaf.ts";
import { Painter, type Scene, type SceneItem } from "../../src/engine/paint.ts";
import { Rng } from "../../src/engine/rng.ts";

export function grow(seed: string, len = 110, ang = 1.3): Scene {
  const pt = new Painter({ width: 240, height: 320 });
  const r = new Rng(seed);
  leaf(pt, r, 120, 40, ang, options(r, len, ang));
  return pt.scene();
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
