// Reads the scenes tikz-flora writes for the web (its pdfout.lua M.scene:
// a PDF content stream with its resources as JSON) into a display list.
// It knows exactly the operators tikz-flora paints and throws on any other,
// so a new one fails loudly instead of drawing wrong. Units stay bp; y is
// turned to run down from the page's top.

import { PathBuilder, type Blend, type Clip, type DisplayList, type Item, type Paint, type RGB } from "./display.ts";

export interface PdfScene {
  readonly width: number;
  readonly height: number;
  // Opacity states: [fill opacity, stroke opacity, blend mode name].
  readonly gs: Record<string, readonly [number, number, string]>;
  // Axial shadings in page space (bp, y up): coords [x0, y0, x1, y1] and
  // stops [offset, r, g, b].
  readonly patterns: Record<string, { readonly coords: readonly number[]; readonly stops: readonly (readonly number[])[] }>;
  // Images: size and base64 RGBA, rows top down.
  readonly images?: Record<string, { readonly w: number; readonly h: number; readonly rgba: string }>;
  readonly content: string;
}

export const OPERATORS = ["q", "Q", "gs", "rg", "RG", "w", "J", "j", "cs", "scn", "m", "l", "c", "h", "W", "n", "f", "f*", "S", "cm", "Do"] as const;
const KNOWN = new Set<string>(OPERATORS);
const BLENDS: Record<string, Blend> = { Normal: "normal", Multiply: "multiply", Screen: "screen" };

type Matrix = [number, number, number, number, number, number];

interface State {
  ca: number;
  CA: number;
  blend: Blend;
  fill: Paint;
  stroke: RGB;
  width: number;
  ctm: Matrix;
  into: Item[];  // where painted items go: the page, or the innermost clip
}

function decode64(s: string): Uint8Array {
  const from = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (from) return from(s);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

export function fromPdfScene(scene: PdfScene): DisplayList {
  const H = scene.height;
  const root: Item[] = [];
  let st: State = { ca: 1, CA: 1, blend: "normal", fill: { kind: "solid", rgb: [0, 0, 0] }, stroke: [0, 0, 0], width: 1, ctm: [1, 0, 0, 1, 0, 0], into: root };
  const stack: State[] = [];
  let path = new PathBuilder();
  let nums: number[] = [];
  let name = "";
  let clipping = false;
  // A page point through the CTM, then turned to y down.
  const pt = (x: number, y: number): [number, number] => {
    const m = st.ctm;
    return [m[0] * x + m[2] * y + m[4], H - (m[1] * x + m[3] * y + m[5])];
  };
  const need = (tok: string, n: number) => {
    if (nums.length !== n) throw new Error(`scene: ${tok} takes ${n} numbers, got ${nums.length}`);
  };
  const take = () => {
    const p = path.build();
    path = new PathBuilder();
    return p;
  };

  const s = scene.content;
  const n = s.length;
  let i = 0;
  while (i < n) {
    let c = s.charCodeAt(i);
    if (c <= 32) { i++; continue; }
    let j = i + 1;
    while (j < n && s.charCodeAt(j) > 32) j++;
    const tok = s.slice(i, j);
    i = j;
    c = tok.charCodeAt(0);
    if ((c >= 48 && c <= 57) || c === 45 || c === 46) {
      const v = +tok;
      if (Number.isNaN(v)) throw new Error(`scene: bad number ${tok}`);
      nums.push(v);
      continue;
    }
    if (c === 47) { name = tok.slice(1); continue; }
    if (!KNOWN.has(tok)) throw new Error(`scene: unknown operator ${tok}`);
    switch (tok) {
      case "q": stack.push(st); st = { ...st }; break;
      case "Q": {
        const prev = stack.pop();
        if (!prev) throw new Error("scene: Q without q");
        st = prev;
        break;
      }
      case "gs": {
        const g = scene.gs[name];
        if (!g) throw new Error(`scene: no opacity state ${name}`);
        const blend = BLENDS[g[2]];
        if (!blend) throw new Error(`scene: unknown blend ${g[2]}`);
        st.ca = g[0]; st.CA = g[1]; st.blend = blend;
        break;
      }
      case "rg": need(tok, 3); st.fill = { kind: "solid", rgb: [nums[0], nums[1], nums[2]] }; break;
      case "RG": need(tok, 3); st.stroke = [nums[0], nums[1], nums[2]]; break;
      case "w": need(tok, 1); st.width = nums[0] * Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])); break;
      case "J": case "j": break; // always round, as display lists draw them
      case "cs": if (name !== "Pattern") throw new Error(`scene: colour space ${name}`); break;
      case "scn": {
        const p = scene.patterns[name];
        if (!p) throw new Error(`scene: no pattern ${name}`);
        // Pattern space is the page's own, whatever the CTM.
        const [x0, y0, x1, y1] = p.coords;
        st.fill = { kind: "linear", from: [x0, H - y0], to: [x1, H - y1], stops: p.stops.map((q) => ({ offset: q[0], rgb: [q[1], q[2], q[3]] as RGB })) };
        break;
      }
      case "cm": need(tok, 6); st.ctm = mul(nums as Matrix, st.ctm); break;
      case "m": need(tok, 2); path.moveTo(...pt(nums[0], nums[1])); break;
      case "l": need(tok, 2); path.lineTo(...pt(nums[0], nums[1])); break;
      case "c": {
        need(tok, 6);
        const [a, b] = pt(nums[0], nums[1]), [cc, d] = pt(nums[2], nums[3]), [e, f] = pt(nums[4], nums[5]);
        path.cubicTo(a, b, cc, d, e, f);
        break;
      }
      case "h": path.close(); break;
      case "W": clipping = true; break;
      case "n": {
        const p = take();
        if (clipping) {
          // The clip holds what this q paints from here on.
          const clip: Clip = { kind: "clip", path: p, rule: "nonzero", items: [] };
          st.into.push(clip);
          st.into = clip.items as Item[];
        }
        clipping = false;
        break;
      }
      case "f": case "f*":
        if (clipping) throw new Error("scene: W before a fill");
        st.into.push({ kind: "fill", path: take(), paint: st.fill, rule: tok === "f*" ? "evenodd" : "nonzero", alpha: st.ca, blend: st.blend });
        break;
      case "S":
        st.into.push({ kind: "stroke", path: take(), rgb: st.stroke, width: st.width, alpha: st.CA, blend: st.blend });
        break;
      case "Do": {
        const im = scene.images?.[name];
        if (!im) throw new Error(`scene: no image ${name}`);
        // The unit square, first row at the top (y = 1 in page space),
        // through the CTM, then turned to y down.
        const m = mul([1, 0, 0, -1, 0, 1], st.ctm);
        const rgba = decode64(im.rgba);
        if (rgba.length !== im.w * im.h * 4) throw new Error(`scene: image ${name} holds ${rgba.length} bytes, not ${im.w}x${im.h}x4`);
        st.into.push({
          kind: "image", width: im.w, height: im.h, rgba, alpha: st.ca, blend: st.blend,
          transform: [m[0], -m[1], m[2], -m[3], m[4], H - m[5]],
        });
        break;
      }
    }
    nums = [];
  }
  if (stack.length) throw new Error(`scene: ${stack.length} unclosed q`);
  if (!path.empty) throw new Error("scene: a path was left unpainted");
  return { width: scene.width, height: H, items: root };
}
