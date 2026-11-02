// A display list: what a flora drawing paints, independent of where it is
// drawn. Renderers (webgl.ts, canvas2d.ts) draw it on screen; a PDF writer
// turns it into a content stream. Coordinates are user units (points, for
// a page) with the origin at the top left and y down. Curves stay curves,
// so each renderer flattens them at its own resolution.

export type Blend = "normal" | "multiply" | "screen";
export type Rule = "nonzero" | "evenodd";
export type RGB = readonly [number, number, number];

// Path verbs. A path is a run of subpaths, each starting with MOVE.
export const MOVE = 0, LINE = 1, CUBIC = 2, CLOSE = 3;

// `verbs` holds one verb per command; `coords` the points they take, in
// order: MOVE and LINE one point (2 numbers), CUBIC three (6), CLOSE none.
export interface Path {
  readonly verbs: Uint8Array;
  readonly coords: Float64Array;
}

export interface Stop {
  readonly offset: number;  // 0-1 along the gradient
  readonly rgb: RGB;
}

// A colour, or a linear gradient from `from` to `to` that extends its end
// colours beyond them (as a PDF axial shading with Extend true).
export type Paint =
  | { readonly kind: "solid"; readonly rgb: RGB }
  | { readonly kind: "linear"; readonly from: readonly [number, number]; readonly to: readonly [number, number]; readonly stops: readonly Stop[] };

// What every painted item shares: its opacity (0-1) and how it blends with
// what is under it.
interface Painted {
  readonly alpha: number;
  readonly blend: Blend;
}

// A filled path. All its subpaths fill as one shape under `rule`, so where
// they overlap the paint is applied once.
export interface Fill extends Painted {
  readonly kind: "fill";
  readonly path: Path;
  readonly paint: Paint;
  readonly rule: Rule;
}

// A stroked path with round caps and joins, `width` units wide. A stroke
// paints once where it crosses itself. No stroke is drawn thinner than one
// device pixel.
export interface Stroke extends Painted {
  readonly kind: "stroke";
  readonly path: Path;
  readonly rgb: RGB;
  readonly width: number;
}

// An image of `width` x `height` pixels, RGBA with straight (not
// premultiplied) alpha, rows top down. `transform` [a, b, c, d, e, f] maps
// the unit square (u right, v down, the first row at v = 0) into user
// units: x = a u + c v + e, y = b u + d v + f.
export interface Image extends Painted {
  readonly kind: "image";
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly transform: readonly [number, number, number, number, number, number];
}

// Items drawn only inside `path` (under `rule`). Clips nest: an item in a
// clip inside a clip is drawn only where both cover.
export interface Clip {
  readonly kind: "clip";
  readonly path: Path;
  readonly rule: Rule;
  readonly items: readonly Item[];
}

export type Item = Fill | Stroke | Image | Clip;

// A drawing `width` x `height` units, its items painted in order.
export interface DisplayList {
  readonly width: number;
  readonly height: number;
  readonly items: readonly Item[];
}

// Builds a Path command by command.
export class PathBuilder {
  private verbs: number[] = [];
  private coords: number[] = [];
  private open = false;

  moveTo(x: number, y: number): this {
    this.verbs.push(MOVE);
    this.coords.push(x, y);
    this.open = true;
    return this;
  }
  lineTo(x: number, y: number): this {
    this.need("lineTo");
    this.verbs.push(LINE);
    this.coords.push(x, y);
    return this;
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.need("cubicTo");
    this.verbs.push(CUBIC);
    this.coords.push(x1, y1, x2, y2, x, y);
    return this;
  }
  close(): this {
    this.need("close");
    this.verbs.push(CLOSE);
    this.open = false;
    return this;
  }
  get empty(): boolean {
    return this.verbs.length === 0;
  }
  build(): Path {
    return { verbs: Uint8Array.from(this.verbs), coords: Float64Array.from(this.coords) };
  }
  private need(op: string): void {
    if (!this.open) throw new Error(`path: ${op} without a current point`);
  }
}

// Every item of `items` and of the clips inside them, depth first, with
// the depth of clips around each.
export function* walk(items: readonly Item[], depth = 0): Generator<[Item, number]> {
  for (const it of items) {
    yield [it, depth];
    if (it.kind === "clip") yield* walk(it.items, depth + 1);
  }
}

// Counts of a list's items by kind, its path commands, and its deepest
// clip nesting.
export function stats(list: DisplayList): { fills: number; strokes: number; images: number; clips: number; commands: number; depth: number } {
  const s = { fills: 0, strokes: 0, images: 0, clips: 0, commands: 0, depth: 0 };
  for (const [it, d] of walk(list.items)) {
    if (it.kind === "fill") s.fills++;
    else if (it.kind === "stroke") s.strokes++;
    else if (it.kind === "image") s.images++;
    else s.clips++;
    if (it.kind !== "image") s.commands += it.path.verbs.length;
    if (it.kind === "clip") s.depth = Math.max(s.depth, d + 1);
  }
  return s;
}
