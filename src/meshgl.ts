// Draws a timeline's frames from its mesh (mesh.ts) with WebGL2: the mesh
// goes to the GPU once, and a frame at growth u walks its tree, drawing
// what is laid down in as few calls as it can.
//
// Items are drawn in paint order. Each has its own depth, rising with its
// place in the order, and the depth test passes only what is nearer than
// what is there: an item's own triangles never paint a pixel twice (a
// stroke's joins over its quads), and every later item paints over it.
// Frames are drawn over an opaque background, which lets multiply and
// screen blend in one pass; with the WEBGL_blend_func_extended extension
// (two outputs, blending as out = src0 + dst src1) every blend shares one
// draw state, and with WEBGL_multi_draw the runs between masks go in one
// call. A group part laid down draws its items inside its mask: the mask
// lifts the stencil where u has reached it (a fragment shader discards
// the rest), the items draw where the stencil is lifted, and the mask
// drops it again. Clips are masks that u does not change.

import type { RGB } from "./display.ts";
import { GRADIENT, ITEM, MASK, MAX_STOPS, VERTEX, walkFrame, type Mesh } from "./mesh.ts";

// Texels across the item and gradient textures.
const ROW = 2048;

const ITEM_VS = `#version 300 es
in vec2 p; in float item;
uniform vec2 size, off; uniform highp sampler2D items;
out vec2 dp; flat out vec4 col; flat out vec4 info;
void main() {
  int k = int(item), i = k * ${ITEM / 4};
  col = texelFetch(items, ivec2(i % ${ROW}, i / ${ROW}), 0);
  info = texelFetch(items, ivec2((i + 1) % ${ROW}, (i + 1) / ${ROW}), 0);
  dp = p;
  vec2 c = (p - off) / size * 2.0 - 1.0;
  // Window depth (k + 1) 2^-22: four steps of a 24-bit buffer apart.
  gl_Position = vec4(c.x, -c.y, -1.0 + float(k + 1) * (8.0 / 16777216.0), 1);
}`;

// Sets c (straight colour), a (opacity) and bl (blend) for the fragment.
const PAINT = `
precision highp float;
in vec2 dp; flat in vec4 col; flat in vec4 info;
uniform float pale; uniform highp sampler2D grads;
vec4 g(int i) { return texelFetch(grads, ivec2(i % ${ROW}, i / ${ROW}), 0); }
void paint(out vec3 c, out float a, out int bl) {
  a = col.a * pale;
  c = col.rgb;
  int gi = int(info.y);
  if (gi >= 0) {
    int b = gi * ${GRADIENT / 4};
    vec4 ends = g(b);
    vec2 d = ends.zw - ends.xy;
    float t = clamp(dot(dp - ends.xy, d) / max(dot(d, d), 1e-12), 0.0, 1.0);
    int n = int(g(b + 1).x);
    vec4 s0 = g(b + 2);
    c = s0.rgb;
    for (int i = 1; i < ${MAX_STOPS}; i++) {
      if (i >= n) break;
      vec4 s1 = g(b + 2 + i);
      if (t > s0.w) c = mix(s0.rgb, s1.rgb, clamp((t - s0.w) / max(s1.w - s0.w, 1e-6), 0.0, 1.0));
      s0 = s1;
    }
  }
  bl = int(info.x);
}`;

// One pass for every blend: out = o0 + dst o1.
const ITEM_FS_DUAL = `#version 300 es
#extension GL_EXT_blend_func_extended : require
${PAINT}
layout(location = 0, index = 0) out vec4 o0;
layout(location = 0, index = 1) out vec4 o1;
void main() {
  vec3 c; float a; int bl;
  paint(c, a, bl);
  if (bl == 1) { o0 = vec4(0); o1 = vec4(c * a + 1.0 - a, 1.0); }
  else if (bl == 2) { o0 = vec4(c * a, a); o1 = vec4(1.0 - c * a, 1.0 - a); }
  else { o0 = vec4(c * a, a); o1 = vec4(1.0 - a); }
}`;

// One blend per draw, set by blendFunc: what each needs as its source.
const ITEM_FS_ONE = `#version 300 es
${PAINT}
out vec4 o;
void main() {
  vec3 c; float a; int bl;
  paint(c, a, bl);
  o = bl == 1 ? vec4(c * a + 1.0 - a, 1.0) : vec4(c * a, a);
}`;

const MASK_VS = `#version 300 es
in vec2 p; in vec2 t;
uniform vec2 size, off;
out vec2 tt;
void main() {
  tt = t;
  vec2 c = (p - off) / size * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0, 1);
}`;

// mode 0: all of it (a clip); 1: where u has passed its main time; 2:
// where u has passed its band time but not its main (still wet).
const MASK_FS = `#version 300 es
precision highp float;
in vec2 tt; uniform float u; uniform int mode;
out vec4 o;
void main() {
  if (mode == 1 && tt.y > u) discard;
  if (mode == 2 && (tt.x > u || tt.y <= u)) discard;
  o = vec4(0);
}`;

export interface MeshDrawOptions {
  // The user point at the canvas's top left.
  readonly x0?: number;
  readonly y0?: number;
  // The opaque colour frames are drawn over; white when omitted.
  readonly background?: RGB;
}

// A mesh on the GPU, and what of its vertices is still to be sent: each
// buffer's data and how many floats of it are there.
interface Sent {
  readonly items: WebGLVertexArrayObject;
  readonly masks: WebGLVertexArrayObject;
  readonly buffers: readonly WebGLBuffer[];
  readonly itemTex: WebGLTexture;
  readonly gradTex: WebGLTexture;
  readonly pending: { readonly buffer: WebGLBuffer; readonly data: Float32Array; at: number }[];
}

interface MultiDraw {
  multiDrawArraysWEBGL(mode: number, firsts: Int32Array, fo: number, counts: Int32Array, co: number, n: number): void;
}

export class MeshRenderer {
  readonly gl: WebGL2RenderingContext;
  // Whether every blend draws in one state (WEBGL_blend_func_extended), and
  // runs between masks in one call (WEBGL_multi_draw).
  readonly dual: boolean;
  readonly multi: boolean;
  private readonly itemProg: WebGLProgram;
  private readonly maskProg: WebGLProgram;
  private readonly iu: Record<string, WebGLUniformLocation | null> = {};
  private readonly mu: Record<string, WebGLUniformLocation | null> = {};
  private readonly sent = new Map<Mesh, Sent>();
  private readonly src1: number;
  private readonly md: MultiDraw | null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, o: { readonly dual?: boolean; readonly multi?: boolean } = {}) {
    const gl = canvas.getContext("webgl2", { stencil: true, depth: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("meshgl: WebGL2 is not available");
    const attrs = gl.getContextAttributes();
    if (!attrs?.stencil) throw new Error("meshgl: no stencil buffer");
    if (!attrs.depth) throw new Error("meshgl: no depth buffer");
    this.gl = gl;
    const ext = o.dual === false ? null : (gl.getExtension("WEBGL_blend_func_extended") as { SRC1_COLOR_WEBGL: number } | null);
    this.dual = ext !== null;
    this.src1 = ext?.SRC1_COLOR_WEBGL ?? 0;
    this.md = o.multi === false ? null : (gl.getExtension("WEBGL_multi_draw") as MultiDraw | null);
    this.multi = this.md !== null;
    this.itemProg = this.program(ITEM_VS, this.dual ? ITEM_FS_DUAL : ITEM_FS_ONE, ["p", "item"]);
    this.maskProg = this.program(MASK_VS, MASK_FS, ["p", "t"]);
    for (const n of ["size", "off", "items", "pale", "grads"]) this.iu[n] = gl.getUniformLocation(this.itemProg, n);
    for (const n of ["size", "off", "u", "mode"]) this.mu[n] = gl.getUniformLocation(this.maskProg, n);
  }

  // Draw `mesh` at growth u over the whole canvas. Returns the time spent
  // sending the mesh (on its first draw) and drawing, ms, and the calls
  // made to draw.
  draw(mesh: Mesh, u: number, o: MeshDrawOptions = {}): { send: number; draw: number; calls: number } {
    const t0 = performance.now();
    const s = this.send(mesh);
    this.upload(mesh, Infinity);
    const t1 = performance.now();
    const gl = this.gl, iu = this.iu, mu = this.mu;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const ox = (o.x0 ?? 0) * mesh.scale, oy = (o.y0 ?? 0) * mesh.scale;
    gl.useProgram(this.maskProg);
    gl.uniform2f(mu.size, W, H);
    gl.uniform2f(mu.off, ox, oy);
    gl.uniform1f(mu.u, u);
    gl.useProgram(this.itemProg);
    gl.uniform2f(iu.size, W, H);
    gl.uniform2f(iu.off, ox, oy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.itemTex);
    gl.uniform1i(iu.items, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, s.gradTex);
    gl.uniform1i(iu.grads, 1);
    gl.uniform1f(iu.pale, 1);
    gl.bindVertexArray(s.items);
    gl.viewport(0, 0, W, H);
    const bg = o.background ?? [1, 1, 1];
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clearDepth(0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.GREATER);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.enable(gl.BLEND);
    if (this.dual) gl.blendFunc(gl.ONE, this.src1);

    let calls = 0;
    // Vertex runs waiting to be drawn, all in blend `blend`.
    const firsts: number[] = [], counts: number[] = [];
    let blend = -1;
    const flush = () => {
      const n = firsts.length;
      if (n === 0) return;
      if (!this.dual) {
        if (blend === 1) gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
        else if (blend === 2) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      if (this.md !== null && n > 1) {
        this.md.multiDrawArraysWEBGL(gl.TRIANGLES, Int32Array.from(firsts), 0, Int32Array.from(counts), 0, n);
        calls++;
      } else {
        for (let i = 0; i < n; i++) gl.drawArrays(gl.TRIANGLES, firsts[i], counts[i]);
        calls += n;
      }
      firsts.length = 0;
      counts.length = 0;
    };
    const run = (first: number, end: number) => {
      const n = firsts.length;
      if (n > 0 && firsts[n - 1] + counts[n - 1] === first) counts[n - 1] = end - firsts[n - 1];
      else {
        firsts.push(first);
        counts.push(end - first);
      }
    };
    const at = mesh.at, blends = mesh.blends;
    const items = (a: number, b: number) => {
      if (this.dual) {
        run(at[a], at[b]);
        return;
      }
      let i = a;
      while (i < b) {
        const bl = blends[i];
        let j = i + 1;
        while (j < b && blends[j] === bl) j++;
        if (bl !== blend) {
          flush();
          blend = bl;
        }
        run(at[i], at[j]);
        i = j;
      }
    };
    // Lift (or drop) the stencil from `depth` over mask triangles
    // first..first + count, as `mode` picks them.
    const mark = (first: number, count: number, mode: number, depth: number, lift: boolean) => {
      flush();
      gl.useProgram(this.maskProg);
      gl.uniform1i(mu.mode, mode);
      gl.bindVertexArray(s.masks);
      gl.colorMask(false, false, false, false);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.stencilFunc(gl.EQUAL, lift ? depth : depth + 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, lift ? gl.INCR : gl.DECR);
      gl.drawArrays(gl.TRIANGLES, first, count);
      calls++;
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilFunc(gl.EQUAL, lift ? depth + 1 : depth, 0xff);
      gl.useProgram(this.itemProg);
      gl.bindVertexArray(s.items);
    };
    let pale = 1;
    walkFrame(mesh, u, {
      items: (a, b, k) => {
        if (k !== pale) {
          flush();
          pale = k;
          gl.uniform1f(iu.pale, k);
        }
        items(a, b);
      },
      enter: (first, count, mode, depth) => mark(first, count, mode, depth, true),
      leave: (first, count, mode, depth) => mark(first, count, mode, depth, false),
    });
    flush();
    gl.bindVertexArray(null);
    return { send: t1 - t0, draw: performance.now() - t1, calls };
  }

  // Send up to `bytes` more of mesh's vertices to the GPU ahead of its first
  // draw, which sends whatever is left. Sending a large mesh a piece at a
  // time, with pauses between, keeps the GPU free for the page's own
  // drawing between pieces. Returns whether all of it is there.
  upload(mesh: Mesh, bytes: number): boolean {
    const s = this.send(mesh), gl = this.gl;
    let room = bytes / 4;
    while (s.pending.length > 0 && room > 0) {
      const p = s.pending[0];
      const n = Math.min(p.data.length - p.at, room);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, p.at * 4, p.data, p.at, n);
      p.at += n;
      room -= n;
      if (p.at >= p.data.length) s.pending.shift();
    }
    if (bytes !== Infinity) gl.flush();
    return s.pending.length === 0;
  }

  // Free what `mesh` holds on the GPU; it is sent again if drawn again.
  release(mesh: Mesh): void {
    const s = this.sent.get(mesh);
    if (s === undefined) return;
    const gl = this.gl;
    gl.deleteVertexArray(s.items);
    gl.deleteVertexArray(s.masks);
    for (const b of s.buffers) gl.deleteBuffer(b);
    gl.deleteTexture(s.itemTex);
    gl.deleteTexture(s.gradTex);
    this.sent.delete(mesh);
  }

  private program(vs: string, fs: string, attribs: readonly string[]): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("meshgl: " + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    attribs.forEach((a, i) => gl.bindAttribLocation(prog, i, a));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("meshgl: " + gl.getProgramInfoLog(prog));
    return prog;
  }

  private send(mesh: Mesh): Sent {
    const had = this.sent.get(mesh);
    if (had !== undefined) return had;
    const gl = this.gl;
    const pending: Sent["pending"] = [];
    // Room for `data`, which upload sends.
    const vao = (data: Float32Array, sizes: readonly number[]): [WebGLVertexArrayObject, WebGLBuffer] => {
      const v = gl.createVertexArray()!;
      gl.bindVertexArray(v);
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, Math.max(4, data.byteLength), gl.STATIC_DRAW);
      if (data.length > 0) pending.push({ buffer: b, data, at: 0 });
      const stride = sizes.reduce((a, x) => a + x, 0) * 4;
      let off = 0;
      sizes.forEach((n, i) => {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, off);
        off += n * 4;
      });
      gl.bindVertexArray(null);
      return [v, b];
    };
    const [items, ib] = vao(mesh.verts, [2, VERTEX - 2]);
    const [masks, mb] = vao(mesh.masks, [2, MASK - 2]);
    const s = { items, masks, buffers: [ib, mb], itemTex: this.texture(mesh.items), gradTex: this.texture(mesh.gradients), pending };
    this.sent.set(mesh, s);
    return s;
  }

  // Floats as an RGBA float texture ROW texels across.
  private texture(data: Float32Array): WebGLTexture {
    const gl = this.gl;
    const rows = Math.max(1, Math.ceil(data.length / 4 / ROW));
    const full = new Float32Array(ROW * rows * 4);
    full.set(data);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW, rows, 0, gl.RGBA, gl.FLOAT, full);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }
}
