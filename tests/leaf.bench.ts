// Runs in Chrome (tests/leaf-bench.mjs): grows a sheet of leaves with the
// engine, converts it to a display list and draws it with WebGL2, timing
// each step. The median of several runs is reported.
import { leaf, Painter, Rng } from "../src/engine/index.ts";
import { toDisplayList } from "../src/scene.ts";
import { stats } from "../src/display.ts";
import { WebGLRenderer } from "../src/webgl.ts";

const q = new URLSearchParams(location.search);
const N = Number(q.get("leaves") ?? 50), RUNS = Number(q.get("runs") ?? 5), SCALE = Number(q.get("scale") ?? 2);
const W = 720, H = 720;

function grow(run: number) {
  const pt = new Painter({ width: W, height: H });
  const cols = Math.ceil(Math.sqrt(N));
  for (let i = 0; i < N; i++) {
    const r = new Rng(`bench ${i}`);
    const x = ((i % cols) + 0.5) * (W / cols), y = (Math.floor(i / cols) + 0.15) * (H / cols);
    const len = 40 + ((i * 37) % 110), ang = 1.2 + ((i * 0.41) % 0.8);
    leaf.leaf(pt, r, x, y, ang, leaf.options(r, len, ang));
  }
  return pt;
}

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const canvas = document.createElement("canvas");
canvas.width = W * SCALE;
canvas.height = H * SCALE;
document.body.append(canvas);
const gl = new WebGLRenderer(canvas);
const t = { engine: [] as number[], convert: [] as number[], prepare: [] as number[], draw: [] as number[] };
let info = {};
for (let run = 0; run < RUNS; run++) {
  const t0 = performance.now();
  const pt = grow(run);
  const scene = pt.scene();
  const t1 = performance.now();
  const list = toDisplayList(scene);
  const t2 = performance.now();
  const d = gl.draw(list, { scale: SCALE, background: [0.976, 0.972, 0.955] });
  t.engine.push(t1 - t0);
  t.convert.push(t2 - t1);
  t.prepare.push(d.prepare);
  t.draw.push(d.draw);
  info = { ...stats(list), triangles: d.triangles, items: pt.count };
}
(window as unknown as { done: unknown }).done = {
  leaves: N, runs: RUNS, scale: SCALE, size: `${W}x${H} pt`,
  engine: median(t.engine), convert: median(t.convert), prepare: median(t.prepare), draw: median(t.draw),
  first: { engine: t.engine[0], convert: t.convert[0], prepare: t.prepare[0], draw: t.draw[0] },
  info,
};
