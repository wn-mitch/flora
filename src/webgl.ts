// Draws a display list with WebGL2.
//
// Fills are drawn by stencil-then-cover: each subpath becomes a triangle
// fan into the stencil's winding bits, then one quad over the fill's box
// colours the pixels whose winding is set (nonzero or odd) and clears
// them. Every subpath of a fill therefore blends once, as in PDF and
// Canvas2D. A stroke's segment quads and join discs mark the stencil the
// same way, so a stroke that crosses itself is painted once.
//
// Geometry is in device px before the view's offset, which the vertex
// shader applies, so a path's triangles serve any window at one scale; a
// renderer keeps them between draws (Store) for paths it sees again.
//
// The stencil's low six bits hold winding; the top two hold how many clips
// a pixel is inside (up to three). Content at clip depth d is drawn where
// the top bits equal d. Entering or leaving a clip flips the top bits that
// differ between d and d + 1 (INVERT under a write mask), so no value ever
// has to be written whole.

import type { Blend, DisplayList, Image, Item, Paint, Path, RGB, Rule } from "./display.ts";
import { bounds, flatten, reaches, type View } from "./flatten.ts";
import { strokeTriangles } from "./tess.ts";

const LOW = 0x3f, SHIFT = 6, MAX_DEPTH = 3;
// The top bits that change between depths d and d + 1.
const step = (d: number) => ((d ^ (d + 1)) << SHIFT) & 0xc0;

// What to draw, made once per list and view. `buf` is where an op's
// vertices are: 0 in the list's own, 1 in the renderer's store.
type Op =
  | { t: "fill"; buf: 0 | 1; start: number; count: number; cover: number; rule: Rule | "union"; paint: Paint; alpha: number; blend: Blend; depth: number }
  | { t: "clip"; buf: 0 | 1; start: number; count: number; cover: number; rule: Rule; depth: number }
  | { t: "unclip"; buf: 0 | 1; cover: number; depth: number }
  | { t: "image"; buf: 0; quad: number; item: Image; depth: number; q0: [number, number]; qu: [number, number]; qv: [number, number] };

// A path's triangles and cover quad, by vertex.
interface Geo {
  readonly start: number;
  readonly count: number;
  readonly cover: number;
}

// Floats kept in a store before it starts afresh: 48 MB.
const STORE_LIMIT = 12 << 20;

// Paths' geometry kept between draws at one scale, for paths drawn again:
// a path is triangulated into the list's own vertices the first time it is
// drawn, and into the store the second, where later draws reuse it. A list
// drawn frame after frame (timeline.ts) thus prepares only what is new in
// each frame. Keyed by path, and for a stroke by its width too.
export class Store {
  scale = NaN;
  data = new Floats();
  // Floats already sent to the GPU, and how many its buffer holds.
  uploaded = 0;
  capacity = 0;
  // A Geo once stored, null for nothing to draw, 0 for seen once.
  private kept = new WeakMap<Path, Map<number, Geo | null | 0>>();

  // Start afresh at `scale`.
  reset(scale: number): void {
    this.scale = scale;
    this.data = new Floats();
    this.uploaded = 0;
    this.capacity = 0;
    this.kept = new WeakMap();
  }

  get(path: Path, key: number): Geo | null | 0 | undefined {
    return this.kept.get(path)?.get(key);
  }

  set(path: Path, key: number, g: Geo | null | 0): void {
    let m = this.kept.get(path);
    if (m === undefined) {
      m = new Map();
      this.kept.set(path, m);
    }
    m.set(key, g);
  }
}

// A Float32Array that grows as it is filled.
class Floats {
  data = new Float32Array(1 << 16);
  n = 0;
  push6(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (this.n + 6 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const x = this.data;
    x[this.n] = a; x[this.n + 1] = b; x[this.n + 2] = c; x[this.n + 3] = d; x[this.n + 4] = e; x[this.n + 5] = f;
    this.n += 6;
  }
  get vertices(): number {
    return this.n / 2;
  }
  quad(x0: number, y0: number, x1: number, y1: number): number {
    const at = this.vertices;
    this.push6(x0, y0, x1, y0, x1, y1);
    this.push6(x0, y0, x1, y1, x0, y1);
    return at;
  }
}

// A fill's (or clip's) triangles into `buf`: a fan per subpath, then the
// cover quad over its box; null when there is nothing to draw.
function fillGeo(buf: Floats, path: Path, v: View): Geo | null {
  const subs = flatten(path, v);
  const box = bounds(subs);
  if (!box) return null;
  const start = buf.vertices;
  for (const p of subs) {
    for (let k = 2; k + 3 < p.length; k += 2) buf.push6(p[0], p[1], p[k], p[k + 1], p[k + 2], p[k + 3]);
  }
  const count = buf.vertices - start;
  return { start, count, cover: buf.quad(...box) };
}

// A stroke's quads and join discs into `buf`, then its cover quad.
function strokeGeo(buf: Floats, path: Path, width: number, v: View): Geo | null {
  const subs = flatten(path, v);
  const hw = Math.max(width * v.scale, 1) / 2;
  const box = bounds(subs, hw);
  if (!box) return null;
  const start = buf.vertices;
  for (const p of subs) strokeTriangles(p, hw, buf);
  const count = buf.vertices - start;
  if (!count) return null;
  return { start, count, cover: buf.quad(...box) };
}

// The ops and vertices for `list` under view `v`. Given a window `win`
// (device px), items that cannot reach it are left out (flatten.ts
// reaches), which draws the same picture for less work when the window
// shows a part of the list. Given a store at v's scale, geometry is kept
// in it and reused (Store); `verts` then holds only what is not.
export function prepare(list: DisplayList, v: View, win?: { readonly w: number; readonly h: number }, store?: Store): { ops: Op[]; verts: Float32Array; triangles: number } {
  const buf = new Floats();
  const ops: Op[] = [];
  // Geometry is made before the view's offset; the shader applies it.
  const at: View = { scale: v.scale, x0: 0, y0: 0 };
  let triangles = 0;
  // Path p's geometry, made by `make`, from the store when it has it.
  const geo = (p: Path, key: number, make: (b: Floats) => Geo | null): [Geo, 0 | 1] | null => {
    if (store === undefined) {
      const g = make(buf);
      return g === null ? null : [g, 0];
    }
    const had = store.get(p, key);
    if (had === null) return null;
    if (had !== undefined && had !== 0) return [had, 1];
    if (had === 0) {
      const g = make(store.data);
      store.set(p, key, g);
      return g === null ? null : [g, 1];
    }
    store.set(p, key, 0);
    const g = make(buf);
    return g === null ? null : [g, 0];
  };
  const walk = (items: readonly Item[], depth: number) => {
    for (const it of items) {
      if (win !== undefined && !reaches(it, v, win.w, win.h)) continue;
      if (it.kind === "fill") {
        const g = geo(it.path, -1, (b) => fillGeo(b, it.path, at));
        if (g === null || !g[0].count) continue;
        triangles += g[0].count / 3;
        ops.push({ t: "fill", buf: g[1], start: g[0].start, count: g[0].count, cover: g[0].cover, rule: it.rule, paint: it.paint, alpha: it.alpha, blend: it.blend, depth });
      } else if (it.kind === "stroke") {
        const g = geo(it.path, it.width, (b) => strokeGeo(b, it.path, it.width, at));
        if (g === null) continue;
        triangles += g[0].count / 3;
        const paint: Paint = { kind: "solid", rgb: it.rgb };
        ops.push({ t: "fill", buf: g[1], start: g[0].start, count: g[0].count, cover: g[0].cover, rule: "union", paint, alpha: it.alpha, blend: it.blend, depth });
      } else if (it.kind === "image") {
        const [a, b, c, d, e, f] = it.transform;
        const P = (u: number, w: number): [number, number] => [(a * u + c * w + e) * v.scale, (b * u + d * w + f) * v.scale];
        const [p00, p10, p11, p01] = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
        const quad = buf.vertices;
        buf.push6(...p00, ...p10, ...p11);
        buf.push6(...p00, ...p11, ...p01);
        const qu: [number, number] = [p10[0] - p00[0], p10[1] - p00[1]];
        const qv: [number, number] = [p01[0] - p00[0], p01[1] - p00[1]];
        triangles += 2;
        ops.push({ t: "image", buf: 0, quad, item: it, depth, q0: p00, qu, qv });
      } else {
        if (depth >= MAX_DEPTH) throw new Error(`webgl: clips nest deeper than ${MAX_DEPTH}`);
        const g = geo(it.path, -1, (b) => fillGeo(b, it.path, at));
        if (g === null) continue; // an empty clip shows nothing
        const [{ start, count, cover }, where] = g;
        triangles += count / 3;
        ops.push({ t: "clip", buf: where, start, count, cover, rule: it.rule, depth });
        walk(it.items, depth + 1);
        ops.push({ t: "unclip", buf: where, cover, depth: depth + 1 });
      }
    }
  };
  walk(list.items, 0);
  return { ops, verts: buf.data.subarray(0, buf.n), triangles };
}

const VS = `#version 300 es
in vec2 p; out vec2 uv; uniform vec2 size, off; uniform vec2 q0, qu, qv;
void main() {
  // For images, uv is recovered from the quad's corners (q0 + u qu + v qv).
  mat2 m = mat2(qu, qv);
  uv = abs(determinant(m)) > 0.0 ? inverse(m) * (p - q0) : vec2(0);
  vec2 c = (p - off) / size * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0, 1);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec4 color; uniform int mode; uniform float height;
uniform vec2 ga, gb; uniform int nstops; uniform float st[8]; uniform vec3 sc[8];
uniform sampler2D tex;
void main() {
  if (mode == 2) { vec4 t = texture(tex, uv); o = vec4(t.rgb * t.a, t.a) * color.a; return; }
  vec3 c = color.rgb;
  if (mode == 1) {
    vec2 p = vec2(gl_FragCoord.x, height - gl_FragCoord.y), d = gb - ga;
    float t = clamp(dot(p - ga, d) / max(dot(d, d), 1e-12), 0.0, 1.0);
    c = sc[0];
    for (int i = 1; i < 8; i++) {
      if (i >= nstops) break;
      if (t > st[i - 1]) c = mix(sc[i - 1], sc[i], clamp((t - st[i - 1]) / max(st[i] - st[i - 1], 1e-6), 0.0, 1.0));
    }
  }
  o = vec4(c * color.a, color.a);
}`;

export interface DrawOptions {
  // Device px per user unit, and the user point at the canvas's top left.
  readonly scale: number;
  readonly x0?: number;
  readonly y0?: number;
  // An opaque colour to clear to first; transparent when omitted.
  readonly background?: RGB;
}

export class WebGLRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vbo: WebGLBuffer;
  // Geometry kept between draws, and the buffer it is sent to.
  private store = new Store();
  private kept: WebGLBuffer;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private textures = new WeakMap<Image, WebGLTexture>();

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", { stencil: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("webgl: WebGL2 is not available");
    if ((gl.getContextAttributes()?.stencil ?? false) === false) throw new Error("webgl: no stencil buffer");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("webgl: " + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("webgl: " + gl.getProgramInfoLog(prog));
    this.prog = prog;
    for (const n of ["size", "off", "q0", "qu", "qv", "color", "mode", "height", "ga", "gb", "nstops", "st", "sc", "tex"]) this.u[n] = gl.getUniformLocation(prog, n);
    this.vbo = gl.createBuffer()!;
    this.kept = gl.createBuffer()!;
  }

  // Draw `list` over the whole canvas. Returns the time spent preparing
  // geometry and drawing, in ms, and the triangle count.
  draw(list: DisplayList, o: DrawOptions): { prepare: number; draw: number; triangles: number } {
    const t0 = performance.now();
    const view = { scale: o.scale, x0: o.x0 ?? 0, y0: o.y0 ?? 0 };
    this.view = view;
    const gl = this.gl, u = this.u;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const st = this.store;
    if (st.scale !== view.scale || st.data.n > STORE_LIMIT) st.reset(view.scale);
    const { ops, verts, triangles } = prepare(list, view, { w: W, h: H }, st);
    const t1 = performance.now();
    gl.useProgram(this.prog);
    // What the store gained this draw goes to its buffer, which grows by
    // doubling (sent whole when it does).
    gl.bindBuffer(gl.ARRAY_BUFFER, this.kept);
    if (st.data.n > st.capacity) {
      st.capacity = Math.max(st.data.n, st.capacity * 2, 1 << 16);
      gl.bufferData(gl.ARRAY_BUFFER, st.capacity * 4, gl.DYNAMIC_DRAW);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, st.data.data, 0, st.data.n);
      st.uploaded = st.data.n;
    } else if (st.data.n > st.uploaded) {
      gl.bufferSubData(gl.ARRAY_BUFFER, st.uploaded * 4, st.data.data, st.uploaded, st.data.n - st.uploaded);
      st.uploaded = st.data.n;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    const loc = gl.getAttribLocation(this.prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    let bound: 0 | 1 = 0;
    gl.uniform2f(u.size, W, H);
    gl.uniform2f(u.off, view.x0 * view.scale, view.y0 * view.scale);
    gl.uniform1f(u.height, H);
    gl.viewport(0, 0, W, H);
    const bg = o.background;
    gl.clearColor(bg ? bg[0] : 0, bg ? bg[1] : 0, bg ? bg[2] : 0, bg ? 1 : 0);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    // A draw ending in a clip leaves colour writes off, which clear obeys.
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    for (const op of ops) {
      if (op.buf !== bound) {
        bound = op.buf;
        gl.bindBuffer(gl.ARRAY_BUFFER, bound === 1 ? this.kept : this.vbo);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
      this.run(op);
    }
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the GPU
    return { prepare: t1 - t0, draw: performance.now() - t1, triangles };
  }

  private run(op: Op): void {
    const gl = this.gl;
    const at = op.depth << SHIFT;
    if (op.t === "unclip") {
      // Leaving depth k: where the top bits are k, flip them to k - 1.
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.EQUAL, at, 0xc0);
      gl.stencilMask(step(op.depth - 1));
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.drawArrays(gl.TRIANGLES, op.cover, 6);
      return;
    }
    if (op.t === "image") {
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0);
      gl.stencilFunc(gl.EQUAL, at, 0xc0);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      this.bindImage(op.item);
      gl.uniform2f(this.u.q0, ...op.q0);
      gl.uniform2f(this.u.qu, ...op.qu);
      gl.uniform2f(this.u.qv, ...op.qv);
      gl.uniform1i(this.u.mode, 2);
      gl.uniform4f(this.u.color, 1, 1, 1, op.item.alpha);
      this.cover(op.item.blend, op.quad, false);
      return;
    }
    // Winding into the low bits.
    gl.colorMask(false, false, false, false);
    gl.stencilMask(LOW);
    if (op.rule === "union") {
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    } else if (op.rule === "evenodd") {
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    } else {
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    }
    gl.drawArrays(gl.TRIANGLES, op.start, op.count);
    // Pixels at this depth with winding set have stencil > at: no pixel's
    // top bits exceed the current depth outside a deeper clip.
    gl.stencilFunc(gl.LESS, at, 0xff);
    if (op.t === "clip") {
      // Entering depth d + 1: where the winding is set at depth d, flip
      // the top bits to d + 1; then clear the winding over the box.
      gl.stencilMask(step(op.depth));
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.drawArrays(gl.TRIANGLES, op.cover, 6);
      gl.stencilMask(LOW);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
      gl.drawArrays(gl.TRIANGLES, op.cover, 6);
      return;
    }
    gl.colorMask(true, true, true, true);
    this.setPaint(op.paint, op.alpha);
    this.cover(op.blend, op.cover, true);
  }

  // Draw the cover quad with `blend`, clearing winding as it passes when
  // `clear`. Multiply takes two passes, which together give Canvas2D's
  // premultiplied multiply exactly, transparent destinations included:
  // first c' = s d + d (1 - as), alpha kept; then c'' = c' + s (1 - ad),
  // alpha'' = as + ad (1 - as).
  private cover(blend: Blend, first: number, clear: boolean): void {
    const gl = this.gl;
    const done = () => {
      if (clear) gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
      else gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    };
    if (blend === "multiply") {
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, first, 6);
      done();
      gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, first, 6);
      return;
    }
    done();
    if (blend === "screen") gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, first, 6);
  }

  private setPaint(p: Paint, alpha: number): void {
    const gl = this.gl, u = this.u;
    if (p.kind === "solid") {
      gl.uniform1i(u.mode, 0);
      gl.uniform4f(u.color, p.rgb[0], p.rgb[1], p.rgb[2], alpha);
      return;
    }
    if (p.stops.length > 8) throw new Error("webgl: a gradient has more than 8 stops");
    const t = new Float32Array(8), c = new Float32Array(24);
    p.stops.forEach((s, k) => { t[k] = s.offset; c.set(s.rgb, k * 3); });
    gl.uniform1i(u.mode, 1);
    gl.uniform4f(u.color, 0, 0, 0, alpha);
    gl.uniform1i(u.nstops, p.stops.length);
    gl.uniform1fv(u.st, t);
    gl.uniform3fv(u.sc, c);
    gl.uniform2f(u.ga, ...this.device(p.from));
    gl.uniform2f(u.gb, ...this.device(p.to));
  }

  // User point to device px under the view of the draw in progress.
  private view: View = { scale: 1, x0: 0, y0: 0 };
  private device(p: readonly [number, number]): [number, number] {
    const v = this.view;
    return [(p[0] - v.x0) * v.scale, (p[1] - v.y0) * v.scale];
  }

  private bindImage(im: Image): void {
    const gl = this.gl;
    let tex = this.textures.get(im);
    if (!tex) {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, im.width, im.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, im.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(im, tex);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u.tex, 0);
  }
}
