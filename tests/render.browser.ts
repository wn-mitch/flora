// Runs in Chrome (tests/browser.mjs). Each case draws a display list with
// the WebGL and Canvas2D renderers and checks pixels against what PDF
// semantics require, and the two renderers against each other.
import { PathBuilder, type Blend, type DisplayList, type Item, type Paint, type RGB, type Rule } from "../src/display.ts";
import { WebGLRenderer } from "../src/webgl.ts";
import { drawCanvas2D } from "../src/canvas2d.ts";
import { compose, leaf, Painter, Rng } from "../src/engine/index.ts";
import { toDisplayList } from "../src/scene.ts";
import { Timeline } from "../src/timeline.ts";
import { meshCases } from "./mesh.browser.ts";

type Px = [number, number, number, number];
const results: { name: string; ok: boolean; msg: string }[] = [];
const log: string[] = [];

function rect(x0: number, y0: number, x1: number, y1: number, ccw = false) {
  const p = new PathBuilder().moveTo(x0, y0);
  if (ccw) p.lineTo(x0, y1).lineTo(x1, y1).lineTo(x1, y0);
  else p.lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1);
  return p.close();
}
// A watercolour blot: a closed outline of `n` cubics whose radius wobbles.
function blot(p: PathBuilder, rnd: () => number, cx: number, cy: number, r: number, n: number) {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI, rr = r * (0.75 + rnd() * 0.5);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  p.moveTo(...pts[0]);
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n], h = 0.3;
    p.cubicTo(a[0] + (b[0] - a[0]) * h + (b[1] - a[1]) * 0.1, a[1] + (b[1] - a[1]) * h - (b[0] - a[0]) * 0.1,
      b[0] - (b[0] - a[0]) * h + (b[1] - a[1]) * 0.1, b[1] - (b[1] - a[1]) * h - (b[0] - a[0]) * 0.1, b[0], b[1]);
  }
  return p.close();
}
function circle(p: PathBuilder, cx: number, cy: number, r: number, ccw = false) {
  const k = 0.5523 * r, d = ccw ? -1 : 1;
  p.moveTo(cx + r, cy)
    .cubicTo(cx + r, cy + k * d, cx + k, cy + r * d, cx, cy + r * d)
    .cubicTo(cx - k, cy + r * d, cx - r, cy + k * d, cx - r, cy)
    .cubicTo(cx - r, cy - k * d, cx - k, cy - r * d, cx, cy - r * d)
    .cubicTo(cx + k, cy - r * d, cx + r, cy - k * d, cx + r, cy)
    .close();
  return p;
}
const solid = (rgb: RGB): Paint => ({ kind: "solid", rgb });
const fill = (path: PathBuilder, rgb: RGB, o: { alpha?: number; blend?: Blend; rule?: Rule; paint?: Paint } = {}): Item =>
  ({ kind: "fill", path: path.build(), paint: o.paint ?? solid(rgb), rule: o.rule ?? "nonzero", alpha: o.alpha ?? 1, blend: o.blend ?? "normal" });

let gl: WebGLRenderer | null = null;
const glCanvas = document.createElement("canvas");

// Both renderings of `list` at `scale`, as straight-alpha RGBA.
function render(list: DisplayList, scale = 1, background?: RGB) {
  const w = Math.round(list.width * scale), h = Math.round(list.height * scale);
  glCanvas.width = w; glCanvas.height = h;
  gl ??= new WebGLRenderer(glCanvas);
  const t = gl.draw(list, { scale, background });
  const read = (src: CanvasImageSource) => {
    const c = new OffscreenCanvas(w, h), x = c.getContext("2d")!;
    x.drawImage(src, 0, 0);
    return x.getImageData(0, 0, w, h).data;
  };
  const a = read(glCanvas);
  const c2 = new OffscreenCanvas(w, h);
  const t0 = performance.now();
  drawCanvas2D(c2.getContext("2d")!, list, { scale, background });
  const b = c2.getContext("2d")!.getImageData(0, 0, w, h).data;
  const c2ms = performance.now() - t0;
  const at = (d: Uint8ClampedArray, x: number, y: number): Px => { const i = (Math.round(y) * w + Math.round(x)) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  return { w, h, gl: a, c2: b, glAt: (x: number, y: number) => at(a, x * scale, y * scale), c2At: (x: number, y: number) => at(b, x * scale, y * scale), timing: t, c2ms };
}

function check(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true, msg: "" }); }
  catch (e) { results.push({ name, ok: false, msg: String((e as Error).message ?? e) }); }
}
const near = (got: Px, want: Px, tol: number, what: string) => {
  if (got.some((v, i) => Math.abs(v - want[i]) > tol)) throw new Error(`${what}: got ${got.join(",")}, want ${want.join(",")} (±${tol})`);
};
// Both renderers give `want` at (x, y).
const both = (r: ReturnType<typeof render>, x: number, y: number, want: Px, tol: number, what: string) => {
  near(r.glAt(x, y), want, tol, `webgl ${what}`);
  near(r.c2At(x, y), want, tol, `canvas2d ${what}`);
};

const L = (items: Item[], width = 64, height = 64): DisplayList => ({ width, height, items });

check("nonzero fills the inner circle of two wound alike; even-odd leaves it open", () => {
  for (const [rule, inner] of [["nonzero", 255], ["evenodd", 0]] as const) {
    const p = circle(circle(new PathBuilder(), 32, 32, 28), 32, 32, 12);
    const r = render(L([fill(p, [1, 0, 0], { rule })]));
    both(r, 32, 32, [inner ? 255 : 0, 0, 0, inner], 2, `${rule} centre`);
    both(r, 32, 10, [255, 0, 0, 255], 2, `${rule} ring`);
  }
  // Wound against each other, nonzero leaves the hole too.
  const p = circle(circle(new PathBuilder(), 32, 32, 28), 32, 32, 12, true);
  both(render(L([fill(p, [1, 0, 0])])), 32, 32, [0, 0, 0, 0], 2, "opposed windings");
});

check("the subpaths of one fill blend once where they overlap", () => {
  const p = rect(4, 4, 40, 40).moveTo(24, 24).lineTo(60, 24).lineTo(60, 60).lineTo(24, 60).close();
  const r = render(L([fill(p, [0, 0, 1], { alpha: 0.5 })]));
  both(r, 32, 32, [0, 0, 255, 128], 3, "overlap");
  both(r, 10, 10, [0, 0, 255, 128], 3, "single");
});

check("a stroke crossing itself paints once; no stroke is under a pixel wide", () => {
  const p = new PathBuilder().moveTo(4, 4).lineTo(60, 60).moveTo(60, 4).lineTo(4, 60);
  const one = new PathBuilder().moveTo(4, 32).lineTo(60, 32).moveTo(60, 4).lineTo(4, 60);
  const r = render(L([{ kind: "stroke", path: one.build(), rgb: [0, 1, 0], width: 6, alpha: 0.5, blend: "normal" }]));
  both(r, 32, 32, [0, 255, 0, 128], 3, "crossing");
  const thin = render(L([{ kind: "stroke", path: p.build(), rgb: [0, 0, 0], width: 0.05, alpha: 1, blend: "normal" }]));
  const a = thin.glAt(16, 16)[3], b = thin.c2At(16, 16)[3];
  if (a < 100 || b < 100) throw new Error(`a 0.05-unit stroke is ${a} (webgl), ${b} (canvas2d) opaque`);
});

check("a clip keeps its items inside it, and only them", () => {
  const items: Item[] = [
    { kind: "clip", path: rect(0, 0, 32, 64).build(), rule: "nonzero", items: [fill(rect(0, 0, 64, 64), [1, 0, 0])] },
    fill(rect(40, 4, 60, 60), [0, 0, 1]),
  ];
  const r = render(L(items));
  both(r, 16, 32, [255, 0, 0, 255], 2, "inside the clip");
  both(r, 36, 32, [0, 0, 0, 0], 2, "outside the clip");
  both(r, 50, 32, [0, 0, 255, 255], 2, "after the clip");
});

check("winding drawn outside a clip does not leak into the next fill", () => {
  // The clipped fill's winding covers the right half too; a ring there
  // after the clip must keep its hole.
  const ring = new PathBuilder().moveTo(36, 4).lineTo(60, 4).lineTo(60, 60).lineTo(36, 60).close().moveTo(42, 10).lineTo(54, 10).lineTo(54, 54).lineTo(42, 54).close();
  const items: Item[] = [
    { kind: "clip", path: rect(0, 0, 30, 64).build(), rule: "nonzero", items: [fill(rect(0, 0, 64, 64), [1, 0, 0])] },
    fill(ring, [0, 1, 0], { rule: "evenodd" }),
  ];
  const r = render(L(items));
  both(r, 48, 32, [0, 0, 0, 0], 2, "the ring's hole");
  both(r, 38, 32, [0, 255, 0, 255], 2, "the ring");
});

check("clips nest three deep as intersections; a fourth is refused", () => {
  const nest = (depth: number, inner: Item[]): Item[] => depth === 0 ? inner
    : [{ kind: "clip", path: rect(depth * 6, 0, 64, 64 - depth * 6).build(), rule: "nonzero", items: nest(depth - 1, inner) }];
  const r = render(L([...nest(3, [fill(rect(0, 0, 64, 64), [1, 1, 0])]), fill(rect(0, 60, 64, 64), [0, 0, 1])]));
  both(r, 30, 30, [255, 255, 0, 255], 2, "inside all three");
  both(r, 8, 30, [0, 0, 0, 0], 2, "outside the innermost");
  both(r, 30, 50, [0, 0, 0, 0], 2, "outside the deepest edge");
  both(r, 30, 62, [0, 0, 255, 255], 2, "after leaving all three");
  let threw = false;
  try { render(L(nest(4, [fill(rect(0, 0, 64, 64), [1, 1, 0])]))); } catch { threw = true; }
  if (!threw) throw new Error("four nested clips drew");
});

check("screen and multiply match Canvas2D over paper, colour and nothing", () => {
  for (const bg of [undefined, [1, 1, 1] as RGB, [0.4, 0.2, 0.6] as RGB]) {
    for (const blend of ["screen", "multiply", "normal"] as const) {
      const items = [fill(rect(0, 0, 64, 64), [0.2, 0.8, 0.4], { alpha: 0.6 }), fill(rect(16, 16, 48, 48), [0.9, 0.3, 0.1], { alpha: 0.7, blend })];
      // Over nothing at the corner, over the first fill in the middle.
      const r = render(L([fill(rect(40, 40, 64, 64), [0, 0, 0], { alpha: 0 }), ...items.slice(1)]), 1, bg);
      near(r.glAt(32, 32), r.c2At(32, 32), 3, `${blend} over ${bg ? bg.join("/") : "transparent"}`);
      const r2 = render(L(items), 1, bg);
      near(r2.glAt(32, 32), r2.c2At(32, 32), 3, `${blend} over a fill on ${bg ? bg.join("/") : "transparent"}`);
    }
  }
});

check("a linear gradient runs between its points and holds its ends beyond", () => {
  const paint: Paint = { kind: "linear", from: [16, 0], to: [48, 0], stops: [{ offset: 0, rgb: [1, 0, 0] }, { offset: 0.5, rgb: [0, 1, 0] }, { offset: 1, rgb: [0, 0, 1] }] };
  const r = render(L([fill(rect(0, 0, 64, 64), [0, 0, 0], { paint })]));
  both(r, 4, 32, [255, 0, 0, 255], 3, "before the start");
  both(r, 32, 32, [0, 255, 0, 255], 12, "the middle stop");
  both(r, 60, 32, [0, 0, 255, 255], 3, "past the end");
  near(r.glAt(24, 32), r.c2At(24, 32), 6, "a quarter along");
});

check("an image lands on its transform, first row on top", () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]);
  const items: Item[] = [{ kind: "image", width: 2, height: 2, rgba, transform: [40, 0, 0, 40, 12, 12], alpha: 1, blend: "normal" }];
  const r = render(L(items));
  // Sampled near each quadrant's outer corner, where smoothing between
  // the four texels has least effect.
  both(r, 15, 15, [255, 0, 0, 255], 6, "top left");
  both(r, 49, 15, [0, 255, 0, 255], 6, "top right");
  both(r, 15, 49, [0, 0, 255, 255], 6, "bottom left");
  both(r, 49, 49, [255, 255, 255, 128], 12, "bottom right, half transparent");
  both(r, 6, 6, [0, 0, 0, 0], 1, "outside");
});

// A garden-like list: fills of several wobbly blots (`segs` cubics each),
// strokes, gradients, blends and clips, `n` items over `size` units.
function garden(n: number, size: number, seed = 1, segs = 4): DisplayList {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blends: Blend[] = ["normal", "multiply", "screen"];
  const items: Item[] = [];
  let into = items;
  for (let i = 0; i < n; i++) {
    const p = new PathBuilder();
    const parts = 1 + Math.floor(rnd() * 6);
    for (let k = 0; k < parts; k++) {
      if (segs <= 4) circle(p, rnd() * size, rnd() * size, 0.3 + rnd() * rnd() * 30, rnd() < 0.5);
      else blot(p, rnd, rnd() * size, rnd() * size, 0.3 + rnd() * rnd() * 30, segs);
    }
    const rgb: RGB = [rnd(), rnd(), rnd()];
    const u = rnd();
    if (u < 0.12) into.push({ kind: "stroke", path: p.build(), rgb, width: rnd() * 3, alpha: 0.3 + rnd() * 0.7, blend: blends[i % 3] });
    else if (u < 0.2) {
      const x = rnd() * size, y = rnd() * size;
      into.push(fill(p, rgb, { alpha: 0.5 + rnd() * 0.5, paint: { kind: "linear", from: [x, y], to: [x + 20, y + 10], stops: [{ offset: 0, rgb }, { offset: 1, rgb: [rgb[2], rgb[0], rgb[1]] }] } }));
    } else into.push(fill(p, rgb, { alpha: 0.1 + rnd() * 0.9, blend: blends[i % 3], rule: rnd() < 0.2 ? "evenodd" : "nonzero" }));
    if (i % 400 === 0) {
      // Every so often, the next items are clipped to a blob.
      const clip = { kind: "clip" as const, path: circle(new PathBuilder(), rnd() * size, rnd() * size, 20 + rnd() * 60).build(), rule: "nonzero" as const, items: [] as Item[] };
      items.push(clip);
      into = clip.items;
    } else if (i % 400 === 60) into = items;
  }
  return { width: size, height: size, items };
}

check("on a garden-like list the renderers agree", () => {
  const r = render(garden(3000, 256), 2);
  let off = 0, inked = 0;
  for (let i = 0; i < r.gl.length; i += 4) {
    if (r.gl[i + 3] || r.c2[i + 3]) inked++;
    const d = Math.max(Math.abs(r.gl[i] - r.c2[i]), Math.abs(r.gl[i + 1] - r.c2[i + 1]), Math.abs(r.gl[i + 2] - r.c2[i + 2]), Math.abs(r.gl[i + 3] - r.c2[i + 3]));
    if (d > 24) off++;
  }
  log.push(`agreement: ${off} of ${inked} inked px differ by more than 24/255 (${((off / inked) * 100).toFixed(2)}%)`);
  if (off / inked > 0.02) throw new Error(`${((off / inked) * 100).toFixed(2)}% of inked pixels differ`);
});

// Fills shaped like a real garden's (tikz-flora's 1440x900 margins: 10.5k
// fills, 1.65M path commands). Most hold a few to dozens of small blots
// round a spot, about 100 commands a fill; about a hundred are grain
// sprinkles, hundreds to thousands of sub-pixel dots in one fill spread
// over a leaf or bloom, where Canvas2D spends nearly all its time (1.86 of
// its 1.93 s). WebGL drew the real garden 16x faster; this asks for 4x.
function grainy(n: number, size: number, seed = 3): DisplayList {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blends: Blend[] = ["normal", "multiply", "screen"];
  const items: Item[] = [];
  for (let i = 0; i < n; i++) {
    const p = new PathBuilder();
    const cx = rnd() * size, cy = rnd() * size, spread = 2 + rnd() * 30;
    const k = 3 + Math.floor(rnd() * 42);
    for (let j = 0; j < k; j++) circle(p, cx + (rnd() - 0.5) * spread, cy + (rnd() - 0.5) * spread, 0.2 + rnd() * rnd() * 3, rnd() < 0.5);
    items.push(fill(p, [rnd(), rnd(), rnd()], { alpha: 0.05 + rnd() * 0.6, blend: blends[i % 3] }));
    if (i % 90 === 0) {
      const g = new PathBuilder();
      const gx = rnd() * size, gy = rnd() * size, w = 120 + rnd() * 200, dots = 300 + Math.floor(rnd() * 1300);
      for (let j = 0; j < dots; j++) circle(g, gx + rnd() * w, gy + rnd() * w, 0.15 + rnd() * 0.5);
      items.push(fill(g, [rnd(), rnd(), rnd()], { alpha: 0.2 + rnd() * 0.4, blend: blends[i % 3] }));
    }
  }
  return { width: size, height: size, items };
}

check("WebGL draws a real garden's volume many times faster than Canvas2D", () => {
  const list = grainy(10500, 900);
  render(list, 1); // warm up shaders and caches
  const r = render(list, 1);
  const glms = r.timing.prepare + r.timing.draw;
  let commands = 0;
  for (const it of list.items) if (it.kind !== "image") commands += it.path.verbs.length;
  log.push(`volume: ${commands} path commands; webgl ${glms.toFixed(0)} ms (prepare ${r.timing.prepare.toFixed(0)}, draw ${r.timing.draw.toFixed(0)}, ${r.timing.triangles} triangles), canvas2d ${r.c2ms.toFixed(0)} ms`);
  if (glms * 4 > r.c2ms) throw new Error(`webgl ${glms.toFixed(0)} ms is not 4x faster than canvas2d ${r.c2ms.toFixed(0)} ms`);
});

// `list` drawn by a renderer with no history, under `o`, as RGBA.
function fresh(list: DisplayList, w: number, h: number, o: { scale: number; x0?: number; y0?: number }): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  new WebGLRenderer(c).draw(list, o);
  return pixels(c, w, h);
}
function pixels(src: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h), x = c.getContext("2d")!;
  x.drawImage(src, 0, 0);
  return x.getImageData(0, 0, w, h).data;
}
function same(a: Uint8ClampedArray, b: Uint8ClampedArray, what: string) {
  let off = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) off++;
  if (off > 0) throw new Error(`${what}: ${off} channels differ`);
}

check("geometry kept between draws draws what a fresh renderer does, at any offset and scale", () => {
  const items: Item[] = [];
  const p = new PathBuilder();
  blot(p, () => 0.4, 60, 60, 40, 9);
  items.push(fill(p, [0.2, 0.3, 0.8], { alpha: 0.7, blend: "multiply" }));
  items.push({ kind: "stroke", path: new PathBuilder().moveTo(10, 150).cubicTo(60, 90, 120, 210, 190, 140).build(), rgb: [0.1, 0.1, 0.3], width: 2.5, alpha: 0.9, blend: "normal" });
  items.push({ kind: "clip", path: circle(new PathBuilder(), 120, 90, 50).build(), rule: "nonzero", items: [fill(rect(70, 40, 200, 200), [0.9, 0.4, 0.2], { alpha: 0.6 })] });
  const list: DisplayList = { width: 200, height: 200, items };
  const c = document.createElement("canvas");
  const r = new WebGLRenderer(c);
  // Whole, three times: from scratch, into the store, from the store.
  c.width = 400; c.height = 400;
  const want = fresh(list, 400, 400, { scale: 2 });
  for (let k = 0; k < 3; k++) {
    r.draw(list, { scale: 2 });
    same(pixels(c, 400, 400), want, `draw ${k + 1}`);
  }
  // A window lower down, from the same store.
  c.width = 400; c.height = 160;
  r.draw(list, { scale: 2, y0: 70 });
  same(pixels(c, 400, 160), fresh(list, 400, 160, { scale: 2, y0: 70 }), "a window at an offset");
  // Another scale starts the store afresh.
  c.width = 300; c.height = 300;
  for (let k = 0; k < 2; k++) {
    r.draw(list, { scale: 1.5 });
    same(pixels(c, 300, 300), fresh(list, 300, 300, { scale: 1.5 }), `scale 1.5, draw ${k + 1}`);
  }
});

check("a timeline's frames drawn one after another match each drawn fresh", () => {
  const pt = new Painter({ width: 240, height: 320, timed: true });
  const rng = new Rng("frames");
  leaf.leaf(pt, rng, 120, 40, 1.3, leaf.options(rng, 110, 1.3));
  const tl = new Timeline(pt.scene());
  const c = document.createElement("canvas");
  c.width = 480; c.height = 640;
  const r = new WebGLRenderer(c);
  let shown = 0;
  for (let i = 0; i <= 12; i++) {
    const list = tl.at((tl.end * i) / 12);
    shown += list.items.length;
    r.draw(list, { scale: 2 });
    same(pixels(c, 480, 640), fresh(list, 480, 640, { scale: 2 }), `frame ${i}`);
  }
  if (shown === 0) throw new Error("the frames show nothing");
  same(pixels(c, 480, 640), fresh(toDisplayList(pt.scene()), 480, 640, { scale: 2 }), "the last frame is the finished leaf");
});

check("a window of a page's frames looks alike between its stretches of change", () => {
  const lines = Array.from({ length: 39 }, (_, i) => ({ x0: 162, x1: 436, y0: 712 - 12 * i, y1: 720 - 12 * i }));
  const spec = { width: 595, height: 842, seed: 6, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
  const pt = new Painter({ width: 595, height: 842, timed: true });
  compose.page(spec, { painter: pt });
  const tl = new Timeline(pt.scene());
  // A window of the margin, drawn at 2 px a unit from its top left.
  const win = [0, 300, 160, 500] as const, w = 320, h = 400;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const r = new WebGLRenderer(c);
  const shot = (u: number) => {
    r.draw(tl.at(u, win), { scale: 2, x0: win[0], y0: win[1] });
    return pixels(c, w, h);
  };
  const ch = tl.changes(win);
  let gaps = 0;
  for (let i = 0; i + 1 < ch.length; i++) {
    const a = ch[i][1], b = ch[i + 1][0];
    if (b - a < 1) continue;
    gaps++;
    same(shot(a + (b - a) * 0.25), shot(a + (b - a) * 0.75), `between stretches ${i} and ${i + 1}`);
  }
  const last = ch[ch.length - 1][1];
  same(shot(last), shot(tl.end), "finished by the last stretch");
  log.push(`changes: ${ch.length} stretches, ${gaps} gaps checked, the window finished at ${last.toFixed(0)} of ${tl.end.toFixed(0)}`);
});

meshCases(check, log);

(window as unknown as { done: unknown }).done = { results, log };
