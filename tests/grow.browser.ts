// Runs in Chrome (tests/render.browser.ts registers these cases): a mesh
// drawn with `keep` goes over what the canvas holds; and a garden drawn
// on the GPU (MeshSurface) ends as its pieces painted over the paper in
// their layers, in the order they are laid down, on a tile watched as it
// grew and on one never in view until it had settled.
import type { RGB } from "../src/engine/color.ts";
import { meshOf } from "../src/mesh.ts";
import { MeshRenderer } from "../src/meshgl.ts";
import { Timeline } from "../src/timeline.ts";
import { WebGLRenderer } from "../src/webgl.ts";
import type { SceneItem } from "../src/engine/paint.ts";
import { Garden, MeshSurface, type Piece } from "../src/grow/index.ts";

type Check = (name: string, fn: () => void) => void;
const PAPER: RGB = [249 / 255, 248 / 255, 244 / 255];

function read(c: HTMLCanvasElement | OffscreenCanvas): Uint8ClampedArray {
  const o = new OffscreenCanvas(c.width, c.height), x = o.getContext("2d")!;
  x.drawImage(c, 0, 0);
  return x.getImageData(0, 0, c.width, c.height).data;
}

// Pixels differing by more than `by` in any channel, as a share of those
// either one inks (off the paper by more than `by`).
function apart(a: Uint8ClampedArray, b: Uint8ClampedArray, by: number): { off: number; inked: number } {
  const paper = PAPER.map((v) => Math.round(v * 255));
  let off = 0, inked = 0;
  const ink = (d: Uint8ClampedArray, i: number) => Math.abs(d[i] - paper[0]) > by || Math.abs(d[i + 1] - paper[1]) > by || Math.abs(d[i + 2] - paper[2]) > by;
  for (let i = 0; i < a.length; i += 4) {
    if (!ink(a, i) && !ink(b, i)) continue;
    inked++;
    if (Math.abs(a[i] - b[i]) > by || Math.abs(a[i + 1] - b[i + 1]) > by || Math.abs(a[i + 2] - b[i + 2]) > by) off++;
  }
  return { off, inked };
}

const square = (x0: number, y0: number, s: number, rgb: [number, number, number]): SceneItem => ({
  kind: "fill", path: { verbs: [0, 1, 1, 1, 3], coords: [x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s] },
  paint: { kind: "solid", rgb }, rule: "nonzero", alpha: 1, blend: "normal",
});

export function growCases(check: Check, log: string[]): void {
  check("a mesh drawn with keep goes over what the canvas holds", () => {
    const one = (it: SceneItem) => meshOf(new Timeline({ width: 100, height: 100, items: [it] }), 1);
    const c = new OffscreenCanvas(100, 100), r = new MeshRenderer(c);
    r.draw(one(square(10, 10, 40, [0.8, 0.1, 0.1])), Infinity, { background: PAPER });
    r.draw(one(square(50, 50, 40, [0.1, 0.1, 0.8])), Infinity, { background: PAPER, keep: true });
    const d = read(c), at = (x: number, y: number) => [d[(y * 100 + x) * 4], d[(y * 100 + x) * 4 + 2]];
    const red = at(20, 20), blue = at(70, 70);
    if (!(red[0] > 180 && red[1] < 60)) throw new Error(`the first mesh is gone: ${red}`);
    if (!(blue[1] > 180 && blue[0] < 60)) throw new Error(`the second mesh is missing: ${blue}`);
  });

  check("a garden on the GPU ends as its pieces painted in their layers, watched or not as it grew", () => {
    const W = 300, H = 1200, scale = 1;
    const tiles = [{ y: 0, h: 600 }, { y: 600, h: 600 }];
    const views: OffscreenCanvas[] = [];
    const s = new MeshSurface({
      width: W, height: H, scale, tiles, paper: PAPER,
      canvas: (_i, w, h) => { const c = new OffscreenCanvas(w, h); views.push(c); return c; },
    });
    const g = new Garden({ width: W, height: H, open: [[0, 0, 270, H]], root: [210, H - 4], heading: -Math.PI / 2, seed: 5, depth: true, gaps: true });
    const all: Piece[] = [];
    // Only the top tile is ever in view while it grows.
    while (!g.done && g.tick < 60000) {
      g.step(5);
      const done = g.takeFinished();
      all.push(...done);
      s.lay(done);
      s.merge(g.settledTo, g.tick);
      s.show(g.live(), g.tick, 0, 600);
    }
    for (let i = 0; i < 200 && s.pending(g.tick); i++) s.show(g.live(), g.tick, 0, 600);
    if (s.pending(g.tick)) throw new Error("tiles still wait to be painted");
    if (s.held !== 0) throw new Error(`${s.held} meshes held once settled`);
    all.sort((a, b) => a.z - b.z || a.end - b.end || a.id - b.id);
    tiles.forEach((t, i) => {
      // What the tile's pieces paint, in that order, as one picture by the
      // stencil renderer (Canvas2D's raster differs from the GPU's on
      // watercolour by far more than any fault would).
      const want = document.createElement("canvas");
      want.width = W * scale;
      want.height = t.h * scale;
      const items = all.filter((p) => p.box[3] > t.y && p.box[1] < t.y + t.h).flatMap((p) => p.tl.at(Infinity).items);
      new WebGLRenderer(want).draw({ width: W, height: H, items }, { scale, y0: t.y, background: PAPER });
      const { off, inked } = apart(read(views[i]), read(want), 24);
      log.push(`grow tile ${i}: ${off} of ${inked} inked px differ by more than 24/255`);
      if (inked < 0.05 * want.width * want.height) throw new Error(`tile ${i}: only ${inked} px inked`);
      if (off / inked > 0.01) throw new Error(`tile ${i}: ${((off / inked) * 100).toFixed(2)}% of inked px differ from its pieces painted in order`);
    });
  });
}
