// The painter: collects what the generator paints as a scene, a display
// list made only of plain arrays and records, so the engine builds it alike
// in JavaScript and in Lua. scene.ts turns a scene into flora's DisplayList
// (typed arrays) at the JavaScript edge.
//
// The generator works in page points with y running up from the foot of
// the page, as PDF does; the scene runs y down from the top, as the display
// list does. Every coordinate is turned over as it is painted.
import { fmt } from "#platform";
import { onGround, type RGB } from "./color.ts";
import type { Cmd, Pt } from "./geom.ts";
import { MIX, PALETTE, type Palette } from "./tune.ts";

export type Blend = "normal" | "multiply" | "screen";
export type Rule = "nonzero" | "evenodd";

// Path verbs, as display.ts numbers them: MOVE and LINE take one point,
// CUBIC three, CLOSE none.
export const MOVE = 0, LINE = 1, CUBIC = 2, CLOSE = 3;

export interface ScenePath {
  readonly verbs: number[];
  readonly coords: number[];
}

export type ScenePaint =
  | { readonly kind: "solid"; readonly rgb: RGB }
  | { readonly kind: "linear"; readonly from: Pt; readonly to: Pt; readonly stops: [number, RGB][] };

export interface SceneFill {
  readonly kind: "fill";
  readonly path: ScenePath;
  readonly paint: ScenePaint;
  readonly rule: Rule;
  readonly alpha: number;
  readonly blend: Blend;
}

export interface SceneStroke {
  readonly kind: "stroke";
  readonly path: ScenePath;
  readonly rgb: RGB;
  readonly width: number;
  readonly alpha: number;
  readonly blend: Blend;
}

export interface SceneClip {
  readonly kind: "clip";
  readonly path: ScenePath;
  readonly rule: Rule;
  readonly items: SceneItem[];
}

export type SceneItem = SceneFill | SceneStroke | SceneClip;

export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly items: SceneItem[];
}

// Ink, pigment and gilding used throughout. Values are sRGB 0-1.
export const PAL = {
  paper: [0.976, 0.972, 0.955] as RGB,
  white: [0.995, 0.993, 0.985] as RGB,
  ink: [0.050, 0.105, 0.260] as RGB,     // navy line work
  deep: [0.045, 0.125, 0.470] as RGB,    // ultramarine, pooled
  blue: [0.080, 0.280, 0.780] as RGB,    // ultramarine, open wash
  sky: [0.300, 0.470, 0.830] as RGB,     // dilute wash
  mist: [0.780, 0.850, 0.950] as RGB,    // ghost wash
  gold: [0.700, 0.560, 0.340] as RGB,
  copper: [0.620, 0.330, 0.180] as RGB,
  cream: [0.960, 0.900, 0.760] as RGB,
};

// Colours never repainted for a dark backdrop: metal, which reads on any
// ground, and white, which paints highlights and glints and stays the
// lightest thing on the page either way.
// orn_gild.ts adds the gilt's own pale and umber.
export const KEEP: RGB[] = [PAL.gold, PAL.copper, PAL.white];

// A map from the generator's coordinates to the page's (Painter.project).
export type Projection = (this: void, x: number, y: number) => Pt;

// A growth clock (the "watch it grow" frames): whether the growth front
// has reached (x, y).
export interface Clock {
  born(x: number, y: number): boolean;
}

// What paints gilt while an ornament draws (ornaments.ts draw): gold and
// copper fills at full strength, and gold strokes, go to it instead of
// being painted flat.
export interface Gilder {
  fill(pt: Painter, paths: readonly (readonly Cmd[])[], tone: "shade" | undefined): void;
  line(pt: Painter, paths: readonly (readonly Cmd[])[], width: number): void;
}

export interface PaintOptions {
  // `blend` multiply or screen; `evenodd` fills under the even-odd rule.
  readonly blend?: Blend;
  readonly evenodd?: boolean;
}

export interface PainterOptions {
  readonly width: number;
  readonly height: number;
  // The dark ground ink is repainted for (color.ts onGround); white paper
  // when undefined.
  readonly backdrop?: RGB;
  // What paints each part (tune.ts PALETTE) and how much of each kind of
  // growth there is (tune.ts MIX); the defaults when undefined.
  readonly palette?: Palette;
  readonly mix?: Readonly<Record<string, number>>;
  // The paper the page is shown on, when it is not PAL.paper (a web page's
  // own): what knocks out under a petal paints in it, so no paler halo
  // shows. On a dark backdrop it is unused; the backdrop is the paper.
  readonly paper?: RGB;
}

// The Bezier arcs of a circle, starting and ending at (x + r, y): four
// quarters, or for a circle under SMALL pt in radius two halves, which
// stray at most 1.3% of the radius from the true circle (under 0.03 pt).
// Most circles on a page are grain dots and florets well under a point
// across.
const K = 0.5523, K2 = 1.3158, SMALL = 2;
function circleArcs(x: number, y: number, r: number): number[][] {
  if (r < SMALL) {
    const h = r * K2;
    return [[x + r, y + h, x - r, y + h, x - r, y], [x - r, y - h, x + r, y - h, x + r, y]];
  }
  const k = r * K;
  return [
    [x + r, y + k, x + k, y + r, x, y + r], [x - k, y + r, x - r, y + k, x - r, y],
    [x - r, y - k, x - k, y - r, x, y - r], [x + k, y - r, x + r, y - k, x + r, y],
  ];
}

const SWAP: Readonly<Record<string, Blend>> = { multiply: "screen", screen: "multiply" };

export class Painter {
  readonly width: number;
  readonly height: number;
  readonly backdrop: RGB | undefined;
  readonly palette: Palette;
  readonly mix: Readonly<Record<string, number>>;
  readonly paper: RGB | undefined;
  // Painted items, for diagnostics.
  count = 0;
  // While set, batched line work paints only what the front has reached
  // (sprig.ts Batch.paint).
  clock: Clock | undefined;
  private root: SceneItem[] = [];
  private open: SceneClip[] = [];
  private inked: Record<string, RGB> = {};
  private projection: Projection | undefined;
  private frameFn: Projection | undefined;
  // Opacities of the open groups (groupBegin), multiplied into each item.
  private groups: number[] = [];
  private alpha = 1;
  // Depth of gilding in progress, which keeps its colour on a dark
  // backdrop.
  metal = 0;
  // While set, gold and copper are gilt (Gilder).
  gild: Gilder | undefined;
  // Paint gilt flat: gold and copper as given, never gilt.
  flatGilt = false;

  constructor(o: PainterOptions) {
    this.width = o.width;
    this.height = o.height;
    this.backdrop = o.backdrop;
    this.palette = o.palette ?? PALETTE;
    this.mix = o.mix ?? MIX;
    this.paper = o.paper;
  }

  // The weight of growth `kind` in this painter's mix (1 when unset).
  factor(kind: string): number {
    return this.mix[kind] ?? MIX[kind] ?? 1;
  }

  // `rgb` as it is painted: itself on white paper (PAL.paper itself as the
  // painter's own paper, when it has one); on a dark backdrop, its lightness
  // turned over (color.ts onGround), unless it is one of KEEP.
  ink(rgb: RGB): RGB {
    const bd = this.backdrop;
    if (bd === undefined && rgb === PAL.paper && this.paper !== undefined) return this.paper;
    if (bd === undefined || this.metal > 0 || KEEP.includes(rgb)) return rgb;
    const key = fmt(rgb[0], 4) + "," + fmt(rgb[1], 4) + "," + fmt(rgb[2], 4);
    let c = this.inked[key];
    if (c === undefined) {
      c = onGround(rgb, bd, PAL.paper);
      this.inked[key] = c;
    }
    return c;
  }

  // On a dark backdrop ink adds light where on paper it takes it away, so
  // multiply and screen trade places.
  blend(mode: Blend | undefined): Blend {
    if (mode === undefined) return "normal";
    return this.backdrop === undefined || this.metal > 0 ? mode : SWAP[mode] ?? mode;
  }

  // Set (or with undefined, clear) a projection every path and shading
  // passes through until it is cleared: a tilted bloom (flower.ts tilt).
  project(fn: Projection | undefined): void {
    this.projection = fn;
  }

  // Set (or with undefined, clear) the frame: a map from a layout frame's
  // own coordinates to the page's (frames.ts). It applies after any
  // projection, so elements that project themselves still land in the
  // frame.
  frame(fn: Projection | undefined): void {
    this.frameFn = fn;
  }

  get currentFrame(): Projection | undefined {
    return this.frameFn;
  }

  // The map every coordinate passes through, or undefined for none.
  map(): Projection | undefined {
    const pj = this.projection, fr = this.frameFn;
    if (pj !== undefined && fr !== undefined) {
      return (x, y) => {
        const q = pj(x, y);
        return fr(q[0], q[1]);
      };
    }
    return pj ?? fr;
  }

  // Run fn in page coordinates, with the projection and frame lifted (gilt
  // worked out after them), and restore them after.
  inPage(fn: () => void): void {
    const pj = this.projection, fr = this.frameFn;
    this.projection = undefined;
    this.frameFn = undefined;
    fn();
    this.projection = pj;
    this.frameFn = fr;
  }

  // A transparency group: what is painted until groupEnd takes `opacity`
  // too. Each item carries the product of the open groups' opacities, as
  // the PDF backend paints a group, so overlaps inside it still stack.
  groupBegin(opacity: number): void {
    this.groups.push(opacity);
    this.alpha *= opacity;
  }

  groupEnd(): void {
    if (this.groups.length === 0) throw new Error("paint: groupEnd without groupBegin");
    this.groups.pop();
    let a = 1;
    for (const g of this.groups) a *= g;
    this.alpha = a;
  }

  // Run fn with metal > 0, so what it paints keeps its colour on a dark
  // backdrop.
  asMetal(fn: () => void): void {
    this.metal++;
    fn();
    this.metal--;
  }

  // Fill one path.
  fill(cmds: readonly Cmd[], rgb: RGB, opacity = 1, o: PaintOptions = {}): void {
    this.fillMany([cmds], rgb, opacity, o);
  }

  // Fill several paths as one shape: where they overlap the paint is
  // applied once.
  fillMany(paths: readonly (readonly Cmd[])[], rgb: RGB, opacity = 1, o: PaintOptions = {}): void {
    const g = this.gild;
    if (g !== undefined && !this.flatGilt && (rgb === PAL.gold || rgb === PAL.copper) && opacity >= 0.5 && o.blend === undefined) {
      this.gild = undefined;
      g.fill(this, paths, rgb === PAL.copper ? "shade" : undefined);
      this.gild = g;
      return;
    }
    this.add({
      kind: "fill", path: this.path(paths), paint: { kind: "solid", rgb: this.ink(rgb) },
      rule: o.evenodd === true ? "evenodd" : "nonzero", alpha: Math.min(1, opacity) * this.alpha, blend: this.blend(o.blend),
    });
  }

  // Stroke one path, `width` pt wide, with round caps and joins.
  stroke(cmds: readonly Cmd[], rgb: RGB, width: number, opacity = 1, o: PaintOptions = {}): void {
    this.strokeMany([cmds], rgb, width, opacity, o);
  }

  strokeMany(paths: readonly (readonly Cmd[])[], rgb: RGB, width: number, opacity = 1, o: PaintOptions = {}): void {
    const g = this.gild;
    if (g !== undefined && !this.flatGilt && rgb === PAL.gold && opacity >= 0.5 && o.blend === undefined) {
      this.gild = undefined;
      g.line(this, paths, width);
      this.gild = g;
      return;
    }
    this.add({ kind: "stroke", path: this.path(paths), rgb: this.ink(rgb), width, alpha: Math.min(1, opacity) * this.alpha, blend: this.blend(o.blend) });
  }

  // Paint gradient `stops` ([offset 0-1, rgb] pairs) so its start lies at p0
  // and its end at p1, covering `half` pt to either side of that axis and
  // half the axis' length beyond either end. Use inside a clip.
  shade(stops: readonly (readonly [number, RGB])[], p0: Pt, p1: Pt, half: number): void {
    const pj = this.map();
    if (pj !== undefined) {
      p0 = pj(p0[0], p0[1]);
      p1 = pj(p1[0], p1[1]);
    }
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return;
    const ux = dx / len, uy = dy / len;
    const nx = -uy * half, ny = ux * half;
    const ext = len * 0.5;
    const a: Pt = [p0[0] - ux * ext, p0[1] - uy * ext];
    const b: Pt = [p1[0] + ux * ext, p1[1] + uy * ext];
    const band: Cmd[] = [["m", a[0] + nx, a[1] + ny], ["l", b[0] + nx, b[1] + ny], ["l", b[0] - nx, b[1] - ny], ["l", a[0] - nx, a[1] - ny], ["z"]];
    // The axis and band are already projected.
    this.add({
      kind: "fill", path: this.path([band], false),
      paint: { kind: "linear", from: this.pt(p0), to: this.pt(p1), stops: stops.map((s): [number, RGB] => [s[0], this.ink(s[1])]) },
      rule: "nonzero", alpha: this.alpha, blend: "normal",
    });
  }

  // Run fn and withdraw everything it painted: its randomness is spent as
  // it would be, but nothing shows (clock.ts, an element not yet born).
  // fn must close every clip and group it opens.
  withdraw(fn: () => void): void {
    const into = this.open.length > 0 ? this.open[this.open.length - 1].items : this.root;
    const n0 = into.length, c0 = this.count, open0 = this.open.length, groups0 = this.groups.length;
    fn();
    if (this.open.length !== open0 || this.groups.length !== groups0) throw new Error("paint: withdraw left a clip or group open");
    while (into.length > n0) into.pop();
    this.count = c0;
  }

  // Everything painted until clipEnd is clipped to `cmds`.
  clipBegin(cmds: readonly Cmd[]): void {
    const clip: SceneClip = { kind: "clip", path: this.path([cmds]), rule: "nonzero", items: [] };
    this.add(clip);
    this.open.push(clip);
  }

  clipEnd(): void {
    if (this.open.length === 0) throw new Error("paint: clipEnd without clipBegin");
    this.open.pop();
  }

  // The scene painted so far. Every clip must be closed.
  scene(): Scene {
    if (this.open.length > 0) throw new Error("paint: a clip is still open");
    if (this.groups.length > 0) throw new Error("paint: a group is still open");
    return { width: this.width, height: this.height, items: this.root };
  }

  private add(it: SceneItem): void {
    const into = this.open.length > 0 ? this.open[this.open.length - 1].items : this.root;
    into.push(it);
    if (it.kind !== "clip") this.count++;
  }

  private pt(p: Pt): Pt {
    return [p[0], this.height - p[1]];
  }

  // The scene path for `paths`, through the projection (unless `project`
  // is false) and with y turned over; circles become Bezier arcs, whose
  // control points are projected.
  private path(paths: readonly (readonly Cmd[])[], project = true): ScenePath {
    const verbs: number[] = [], coords: number[] = [];
    const H = this.height;
    const pj = project ? this.map() : undefined;
    const put = (x: number, y: number): void => {
      if (pj === undefined) {
        coords.push(x, H - y);
      } else {
        const q = pj(x, y);
        coords.push(q[0], H - q[1]);
      }
    };
    for (const cmds of paths) {
      for (const c of cmds) {
        if (c[0] === "m") {
          verbs.push(MOVE);
          put(c[1], c[2]);
        } else if (c[0] === "l") {
          verbs.push(LINE);
          put(c[1], c[2]);
        } else if (c[0] === "c") {
          verbs.push(CUBIC);
          put(c[1], c[2]);
          put(c[3], c[4]);
          put(c[5], c[6]);
        } else if (c[0] === "z") {
          verbs.push(CLOSE);
        } else {
          const x = c[1], y = c[2], r = c[3];
          verbs.push(MOVE);
          put(x + r, y);
          for (const a of circleArcs(x, y, r)) {
            verbs.push(CUBIC);
            put(a[0], a[1]);
            put(a[2], a[3]);
            put(a[4], a[5]);
          }
          verbs.push(CLOSE);
        }
      }
    }
    return { verbs, coords };
  }
}
