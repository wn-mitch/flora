// Runs in Chrome (tools/grow.mjs): grows a page with its timeline and draws
// its frames, the plants laid down stroke by stroke over the page's text.
// The page is /spec.json when served (a FloraSpec), else a body page of
// seed ?seed; its text is /text.png when served, a render of the page's
// text with the page's own size, else lorem ipsum set in its lines.
// window.frame(u) draws the frame at growth u and returns it as a PNG data
// URL; window.time(u) times drawing it; window.ready holds { end } once the
// page has grown. Frames are drawn from the page's mesh (src/mesh.ts) over
// white and multiplied onto the page, as the paint would sit on it.
import { compose, Painter } from "../src/engine/index.ts";
import type { FloraSpec } from "../src/engine/frames.ts";
import { meshOf } from "../src/mesh.ts";
import { MeshRenderer } from "../src/meshgl.ts";
import { Timeline } from "../src/timeline.ts";

const q = new URLSearchParams(location.search);
const PAPER = "rgb(249, 248, 244)";

async function specOf(): Promise<FloraSpec> {
  const got = await fetch("/spec.json");
  if (got.ok) return (await got.json()) as FloraSpec;
  // A body page: 39 lines of text and a short last one.
  const lines: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let i = 0; i < 39; i++) lines.push({ x0: 162, x1: 436, y0: 712 - 12 * i, y1: 720 - 12 * i });
  lines.push({ x0: 162, x1: 300, y0: 244, y1: 252 });
  const layout = q.get("layout") ?? undefined;
  return { width: 595, height: 842, seed: Number(q.get("seed") ?? 3), layout, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
}

async function textOf(): Promise<ImageBitmap | undefined> {
  const got = await fetch("/text.png");
  return got.ok ? createImageBitmap(await got.blob()) : undefined;
}

const [spec, textImage] = await Promise.all([specOf(), textOf()]);
const W = spec.width, H = spec.height;
// A text render sets the scale; otherwise ?scale does.
const SCALE = textImage !== undefined ? textImage.width / W : Number(q.get("scale") ?? 1.5);

const pt = new Painter({ width: W, height: H, timed: true });
compose.page(spec, { painter: pt });
const tl = new Timeline(pt.scene());
const mesh = meshOf(tl, SCALE);

const flora = new OffscreenCanvas(Math.round(W * SCALE), Math.round(H * SCALE));
const gl = new MeshRenderer(flora);
const out = document.createElement("canvas");
out.width = flora.width;
out.height = flora.height;
document.body.append(out);
const ctx = out.getContext("2d")!;

const WORDS = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua " +
  "ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in " +
  "reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur").split(" ");

// Lorem ipsum in each of the spec's lines, justified.
function lorem(): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = "rgb(40, 38, 36)";
  ctx.textBaseline = "alphabetic";
  let w = 0;
  for (const l of spec.lines) {
    const size = (l.y1 - l.y0) * 1.25 * SCALE;
    ctx.font = `${size}px Georgia, serif`;
    const x0 = l.x0 * SCALE, x1 = l.x1 * SCALE, y = (H - l.y0) * SCALE;
    const row: string[] = [];
    let width = 0;
    for (;;) {
      const word = WORDS[w % WORDS.length];
      const ww = ctx.measureText(word).width + size * 0.3;
      if (width + ww > x1 - x0 && row.length > 0) break;
      row.push(word);
      width += ww;
      w++;
    }
    const gap = row.length > 1 ? (x1 - x0 - row.reduce((s, r) => s + ctx.measureText(r).width, 0)) / (row.length - 1) : 0;
    let x = x0;
    for (const word of row) {
      ctx.fillText(word, x, y);
      x += ctx.measureText(word).width + gap;
    }
  }
}

function frame(u: number): string {
  gl.draw(mesh, u);
  ctx.globalCompositeOperation = "source-over";
  if (textImage !== undefined) ctx.drawImage(textImage, 0, 0, out.width, out.height);
  else lorem();
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(flora, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return out.toDataURL("image/png");
}

// The time (ms) to draw the frame at u, the GPU's work included, and the
// draw calls it took.
function time(u: number): { draw: number; calls: number } {
  const t0 = performance.now();
  const d = gl.draw(mesh, u);
  const px = new Uint8Array(4);
  gl.gl.readPixels(0, 0, 1, 1, gl.gl.RGBA, gl.gl.UNSIGNED_BYTE, px);
  return { draw: performance.now() - t0, calls: d.calls };
}

const w = window as unknown as { frame: typeof frame; time: typeof time; ready: { end: number } };
w.frame = frame;
w.time = time;
w.ready = { end: tl.end };
