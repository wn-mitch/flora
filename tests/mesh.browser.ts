// Runs in Chrome (tests/render.browser.ts registers these cases): a
// timeline's mesh drawn by MeshRenderer against what it stands for. Its
// finished frame is the stencil renderer's picture over the same paper;
// an item paints each pixel once, later items over earlier; every way of
// blending draws alike; a pen's sweep shows what it has passed, pale where
// still wet; a window's own mesh draws what the page's does there; and a
// page's frames are Timeline.at's up to the edge of what is laid down.
import type { RGB } from "../src/display.ts";
import { compose, Painter, leaf, Rng } from "../src/engine/index.ts";
import type { Scene, SceneItem, Sweep } from "../src/engine/paint.ts";
import { WET } from "../src/engine/timeline.ts";
import { meshOf } from "../src/mesh.ts";
import { MeshRenderer } from "../src/meshgl.ts";
import { Timeline } from "../src/timeline.ts";
import { WebGLRenderer } from "../src/webgl.ts";

type Check = (name: string, fn: () => void) => void;
const PAPER: RGB = [249 / 255, 248 / 255, 244 / 255];

function read(c: HTMLCanvasElement): Uint8ClampedArray {
  const o = new OffscreenCanvas(c.width, c.height), x = o.getContext("2d")!;
  x.drawImage(c, 0, 0);
  return x.getImageData(0, 0, c.width, c.height).data;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Pixels differing by more than `by` in any channel, as a share of all.
function apart(a: Uint8ClampedArray, b: Uint8ClampedArray, by: number): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > by || Math.abs(a[i + 1] - b[i + 1]) > by || Math.abs(a[i + 2] - b[i + 2]) > by) n++;
  }
  return n / (a.length / 4);
}

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ verbs: [0, 1, 1, 1, 3], coords: [x0, y0, x1, y0, x1, y1, x0, y1] });
const fillOf = (path: { verbs: number[]; coords: number[] }, rgb: [number, number, number], alpha: number, blend: "normal" | "multiply" | "screen" = "normal"): SceneItem =>
  ({ kind: "fill", path, paint: { kind: "solid", rgb }, rule: "nonzero", alpha, blend });

// A line sweep along y = 50 from x = 0 to 200, half 30 wide.
function pen(wet: number): Sweep {
  const pts: number[] = [], arc: number[] = [];
  for (let i = 0; i <= 20; i++) { pts.push(i * 10, 50); arc.push(i * 10); }
  return { kind: "line", b: 0, d: 200, pts, arc, half: 30, wet };
}

export function meshCases(check: Check, log: string[]): void {
  check("a mesh's finished frame is the stencil renderer's picture over paper", () => {
    const items: SceneItem[] = [
      fillOf(rect(10, 10, 120, 90), [0.2, 0.4, 0.8], 0.6),
      fillOf(rect(60, 40, 180, 140), [0.9, 0.5, 0.1], 0.5, "multiply"),
      fillOf(rect(30, 70, 150, 170), [0.3, 0.8, 0.5], 0.7, "screen"),
      // Two subpaths of one fill overlapping: painted once where they meet.
      fillOf({ verbs: [0, 1, 1, 1, 3, 0, 1, 1, 1, 3], coords: [20, 120, 90, 120, 90, 190, 20, 190, 50, 150, 120, 150, 120, 195, 50, 195] }, [0.5, 0.1, 0.5], 0.5),
      // A stroke crossing itself: painted once where it crosses.
      { kind: "stroke", path: { verbs: [0, 1, 1, 1], coords: [100, 20, 190, 110, 190, 20, 100, 110] }, rgb: [0.1, 0.1, 0.3], width: 8, alpha: 0.5, blend: "normal" },
      { kind: "fill", path: rect(130, 150, 195, 195), paint: { kind: "linear", from: [130, 0], to: [195, 0], stops: [[0, [1, 0, 0]], [0.5, [0, 1, 0]], [1, [0, 0, 1]]] }, rule: "nonzero", alpha: 0.8, blend: "normal" },
      { kind: "clip", path: { verbs: [0, 1, 1, 3], coords: [0, 200, 100, 100, 200, 200] }, rule: "nonzero", items: [fillOf(rect(0, 150, 200, 200), [0.8, 0.2, 0.2], 0.4)] },
    ];
    const scene: Scene = { width: 200, height: 200, items };
    const tl = new Timeline(scene);
    const a = canvas(400, 400), b = canvas(400, 400);
    new MeshRenderer(a).draw(meshOf(tl, 2), tl.end, { background: PAPER });
    new WebGLRenderer(b).draw(tl.at(tl.end), { scale: 2, background: PAPER });
    const pa = read(a), pb = read(b);
    const off = apart(pa, pb, 6);
    if (off > 0.01) throw new Error(`${(off * 100).toFixed(2)}% of pixels differ from the stencil renderer's`);
    // Inside the crossing and the subpaths' overlap, exactly.
    for (const [x, y] of [[145, 65], [70, 170], [100, 175], [160, 172]]) {
      const i = (y * 2 * 400 + x * 2) * 4;
      for (let k = 0; k < 3; k++) if (Math.abs(pa[i + k] - pb[i + k]) > 2) throw new Error(`at (${x}, ${y}): ${pa.slice(i, i + 3)} against ${pb.slice(i, i + 3)}`);
    }
  });

  check("blending in one pass or one per draw, in one call or many, draws alike", () => {
    const pt = new Painter({ width: 240, height: 320, timed: true });
    const rng = new Rng("mesh blends");
    leaf.leaf(pt, rng, 120, 40, 1.3, leaf.options(rng, 110, 1.3));
    const tl = new Timeline(pt.scene());
    const mesh = meshOf(tl, 2);
    const ways = [{}, { dual: false }, { multi: false }, { dual: false, multi: false }].map((o) => ({ o, c: canvas(480, 640) }));
    const rs = ways.map((w) => new MeshRenderer(w.c, w.o));
    for (const k of [0.3, 0.6, 1]) {
      const shots = ways.map((w, i) => { rs[i].draw(mesh, tl.end * k, { background: PAPER }); return read(w.c); });
      for (let i = 1; i < shots.length; i++) {
        const off = apart(shots[0], shots[i], 1);
        if (off > 0) throw new Error(`at ${k} of the growth, ${JSON.stringify(ways[i].o)} differs at ${(off * 100).toFixed(3)}% of pixels`);
      }
    }
  });

  check("a mesh sent a piece at a time draws what one sent whole does", () => {
    const pt = new Painter({ width: 240, height: 320, timed: true });
    const rng = new Rng("mesh pieces");
    leaf.leaf(pt, rng, 120, 40, 1.3, leaf.options(rng, 110, 1.3));
    const tl = new Timeline(pt.scene());
    const a = canvas(480, 640), b = canvas(480, 640);
    const ra = new MeshRenderer(a), rb = new MeshRenderer(b);
    const ma = meshOf(tl, 2), mb = meshOf(tl, 2);
    let pieces = 0;
    while (!ra.upload(ma, 64 << 10)) pieces++;
    if (pieces < 2) throw new Error(`sent in ${pieces + 1} pieces`);
    for (const k of [0.5, 1]) {
      ra.draw(ma, tl.end * k, { background: PAPER });
      rb.draw(mb, tl.end * k, { background: PAPER });
      const off = apart(read(a), read(b), 0);
      if (off > 0) throw new Error(`at ${k} of the growth ${(off * 100).toFixed(3)}% of pixels differ`);
    }
  });

  check("a pen's sweep shows what it has passed, pale where still wet, and nothing ahead", () => {
    const ink: [number, number, number] = [0.1, 0.2, 0.6];
    const scene: Scene = { width: 200, height: 100, items: [{ kind: "timed", sweeps: [pen(20)], items: [fillOf(rect(0, 35, 200, 65), ink, 0.8)] }] };
    const tl = new Timeline(scene);
    const c = canvas(200, 100);
    new MeshRenderer(c).draw(meshOf(tl, 1), 100, { background: PAPER });
    const px = read(c);
    const at = (x: number) => Array.from(px.slice((50 * 200 + x) * 4, (50 * 200 + x) * 4 + 3));
    const over = (a: number) => PAPER.map((p, k) => Math.round((ink[k] * a + p * (1 - a)) * 255));
    const near = (got: number[], want: number[], what: string) => {
      if (got.some((v, k) => Math.abs(v - want[k]) > 2)) throw new Error(`${what}: got ${got}, want ${want}`);
    };
    near(at(40), over(0.8), "dry, behind the wet front");
    near(at(90), over(0.8 * WET), "wet, just behind the pen");
    near(at(150), over(0), "ahead of the pen");
  });

  check("a window's own mesh draws what the page's mesh does there", () => {
    const pt = new Painter({ width: 240, height: 320, timed: true });
    const rng = new Rng("mesh window");
    leaf.leaf(pt, rng, 120, 40, 1.3, leaf.options(rng, 110, 1.3));
    const tl = new Timeline(pt.scene());
    const win = [0, 120, 240, 220] as const;
    const whole = meshOf(tl, 2), part = meshOf(tl, 2, win);
    const a = canvas(480, 200), b = canvas(480, 200);
    const ra = new MeshRenderer(a), rb = new MeshRenderer(b);
    for (const k of [0.25, 0.5, 0.75, 1]) {
      ra.draw(whole, tl.end * k, { y0: win[1], background: PAPER });
      rb.draw(part, tl.end * k, { y0: win[1], background: PAPER });
      const off = apart(read(a), read(b), 1);
      if (off > 0) throw new Error(`at ${k} of the growth, ${(off * 100).toFixed(3)}% of pixels differ`);
    }
    if (part.verts.length >= whole.verts.length) throw new Error("the window's mesh holds as much as the page's");
  });

  check("a page's mesh frames are its timeline's frames, up to the edge of what is laid down", () => {
    const lines = Array.from({ length: 39 }, (_, i) => ({ x0: 162, x1: 436, y0: 712 - 12 * i, y1: 720 - 12 * i }));
    const spec = { width: 595, height: 842, seed: 6, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
    const pt = new Painter({ width: 595, height: 842, timed: true });
    compose.page(spec, { painter: pt });
    const tl = new Timeline(pt.scene());
    const win = [0, 300, 160, 500] as const, w = 320, h = 400;
    const a = canvas(w, h), b = canvas(w, h);
    const mr = new MeshRenderer(a), gl = new WebGLRenderer(b);
    const mesh = meshOf(tl, 2, win);
    const worst: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const u = (tl.end * i) / 8;
      const d = mr.draw(mesh, u, { y0: win[1], background: PAPER });
      gl.draw(tl.at(u, win), { scale: 2, y0: win[1], background: PAPER });
      const off = apart(read(a), read(b), 24);
      worst.push(`${(off * 100).toFixed(2)}% (${d.calls} calls)`);
      // The mask's edge lies within a pixel or two of the clip's: a thin
      // seam along what is being laid down, never whole parts.
      if (off > (i === 8 ? 0.002 : 0.02)) throw new Error(`at ${i}/8 of the growth ${(off * 100).toFixed(2)}% of pixels differ`);
    }
    log.push(`mesh frames against the timeline's, pixels apart by more than 24: ${worst.join(", ")}`);
  });
}
