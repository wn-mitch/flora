// The engine's scenes (engine/paint.ts: plain arrays and records, so the
// engine builds them alike in Lua) as display lists, with each path's verbs
// and coordinates in typed arrays for the renderers. Coordinates go into a
// Float64Array, which holds every JavaScript number exactly, so nothing the
// engine painted is moved. Malformed paths throw here rather than draw
// wrong.
import { CLOSE, CUBIC, LINE, MOVE, type DisplayList, type Item, type Paint, type Path } from "./display.ts";
import type { Scene, SceneItem, ScenePaint, ScenePath } from "./engine/paint.ts";

const TAKES = [2, 2, 6, 0]; // coordinates each verb takes: MOVE, LINE, CUBIC, CLOSE

function path(p: ScenePath): Path {
  let need = 0;
  for (let i = 0; i < p.verbs.length; i++) {
    const v = p.verbs[i];
    if (v !== MOVE && v !== LINE && v !== CUBIC && v !== CLOSE) throw new Error(`scene: path verb ${i} is ${v}, not 0-3`);
    if (i === 0 && v !== MOVE) throw new Error("scene: a path must start with a move");
    need += TAKES[v];
  }
  if (need !== p.coords.length) throw new Error(`scene: path verbs take ${need} coordinates, it has ${p.coords.length}`);
  return { verbs: Uint8Array.from(p.verbs), coords: Float64Array.from(p.coords) };
}

function paint(p: ScenePaint): Paint {
  if (p.kind === "solid") return { kind: "solid", rgb: [p.rgb[0], p.rgb[1], p.rgb[2]] };
  return {
    kind: "linear",
    from: [p.from[0], p.from[1]],
    to: [p.to[0], p.to[1]],
    stops: p.stops.map(([offset, rgb]) => ({ offset, rgb: [rgb[0], rgb[1], rgb[2]] as const })),
  };
}

function item(it: SceneItem): Item {
  if (it.kind === "fill") return { kind: "fill", path: path(it.path), paint: paint(it.paint), rule: it.rule, alpha: it.alpha, blend: it.blend };
  if (it.kind === "stroke") return { kind: "stroke", path: path(it.path), rgb: [it.rgb[0], it.rgb[1], it.rgb[2]], width: it.width, alpha: it.alpha, blend: it.blend };
  return { kind: "clip", path: path(it.path), rule: it.rule, items: it.items.map(item) };
}

export function toDisplayList(scene: Scene): DisplayList {
  return { width: scene.width, height: scene.height, items: scene.items.map(item) };
}
