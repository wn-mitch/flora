// A scene recorded with its timeline (engine/timeline.ts) as display lists
// of its frames. Paths are converted once, so drawing frame after frame
// converts only the clips the sweeps make at that frame, and a renderer
// that keeps geometry by path (webgl.ts) prepares the rest once.
import type { DisplayList, Fill, Item, Path, Rule, Stroke } from "./display.ts";
import { pathBox } from "./flatten.ts";
import type { Scene, SceneItem, Sweep } from "./engine/paint.ts";
import { done, reveal, WET } from "./engine/timeline.ts";
import { fill, path, stroke } from "./scene.ts";

// A box [x0, y0, x1, y1] in user units.
type Box = readonly [number, number, number, number];
const NONE: Box = [Infinity, Infinity, -Infinity, -Infinity];
const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const meets = (a: Box, b: Box): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// A clip or timed group keeps the box round what it paints, and a timed
// group when it starts and when it, and everything in it, is laid down.
export type Group =
  | { readonly kind: "clip"; readonly path: Path; readonly rule: Rule; readonly items: readonly Node[]; readonly box: Box; readonly end: number; readonly start: number }
  | { readonly kind: "timed"; readonly sweeps: readonly Sweep[]; readonly items: readonly Node[]; readonly final?: readonly Node[]; readonly box: Box; readonly end: number; readonly start: number };
export type Node = Fill | Stroke | Group;

function boxOf(n: Node): Box {
  if (n.kind === "fill") return pathBox(n.path) ?? NONE;
  if (n.kind === "stroke") {
    const b = pathBox(n.path);
    return b === null ? NONE : [b[0] - n.width / 2, b[1] - n.width / 2, b[2] + n.width / 2, b[3] + n.width / 2];
  }
  return n.box;
}

const endOf = (n: Node): number => (n.kind === "fill" || n.kind === "stroke" ? 0 : n.end);
const startOf = (n: Node): number => (n.kind === "fill" || n.kind === "stroke" ? Infinity : n.start);

function nodes(list: readonly SceneItem[]): Node[] {
  return list.map((it): Node => {
    if (it.kind === "fill") return fill(it);
    if (it.kind === "stroke") return stroke(it);
    const items = nodes(it.items);
    const final = it.kind === "timed" && it.final !== undefined ? nodes(it.final) : undefined;
    let box = NONE, end = 0, start = Infinity;
    for (const n of [...items, ...(final ?? [])]) {
      box = union(box, boxOf(n));
      end = Math.max(end, endOf(n));
      start = Math.min(start, startOf(n));
    }
    if (it.kind === "clip") {
      const p = path(it.path);
      const cb = pathBox(p);
      // Nothing inside a clip shows outside it.
      if (cb !== null) box = [Math.max(box[0], cb[0]), Math.max(box[1], cb[1]), Math.min(box[2], cb[2]), Math.min(box[3], cb[3])];
      return { kind: "clip", path: p, rule: it.rule, items, box, end, start };
    }
    for (const s of it.sweeps) {
      end = Math.max(end, done(s));
      start = Math.min(start, s.b);
    }
    // A group with no sweeps of its own shows whatever its parts show.
    if (it.sweeps.length === 0 && start === Infinity) start = -Infinity;
    return { kind: "timed", sweeps: it.sweeps, items, final, box, end, start };
  });
}

export class Timeline {
  readonly width: number;
  readonly height: number;
  // The growth by which everything is laid down.
  readonly end: number;
  // The scene's items, each group with its box and times (mesh.ts reads
  // them to lay a frame's times on its vertices).
  readonly root: readonly Node[];
  // The pale copies of items drawn in wet bands, kept so a renderer sees
  // the same items frame after frame.
  private readonly wet = new WeakMap<Fill | Stroke, Map<number, Fill | Stroke>>();

  constructor(scene: Scene) {
    this.width = scene.width;
    this.height = scene.height;
    this.root = nodes(scene.items);
    this.end = this.root.reduce((e, n) => Math.max(e, endOf(n)), 0);
  }

  // The frame at growth u (pt of growth); at or past `end`, the finished
  // scene. Given a window [x0, y0, x1, y1] (user units), groups wholly
  // outside it are left out, which a renderer drawing only that window
  // would leave out too.
  at(u: number, win?: Box): DisplayList {
    return { width: this.width, height: this.height, items: this.walk(this.root, u, 1, [], win) };
  }

  // The stretches of growth over which what lies in window `win` changes,
  // [from, to] pairs in order, none overlapping: outside them a frame of
  // the window looks as it did at the stretch before. Nothing timed
  // reaching the window gives none. With `final` false, a batch painted in
  // parts switching to its painting done at once (Painter.batched), which
  // changes only where its parts overlap, is left out: for a caller that
  // shows the finished scene itself once the rest is done.
  changes(win: Box, o: { readonly final?: boolean } = {}): [number, number][] {
    const out: [number, number][] = [];
    const visit = (list: readonly Node[]) => {
      for (const n of list) {
        if (n.kind === "fill" || n.kind === "stroke" || !meets(n.box, win)) continue;
        if (n.kind === "timed") {
          // A group painted in parts changes once more, to its painting
          // done at once.
          if (n.final !== undefined && o.final !== false) out.push([n.end, n.end]);
          for (const sw of n.sweeps) {
            const c = sweepIn(sw, win);
            if (c !== null) out.push(c);
          }
        }
        visit(n.items);
      }
    };
    visit(this.root);
    out.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const c of out) {
      const last = merged[merged.length - 1];
      if (last !== undefined && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
      else merged.push([c[0], c[1]]);
    }
    return merged;
  }

  private walk(list: readonly Node[], u: number, k: number, out: Item[], win: Box | undefined): Item[] {
    for (const n of list) {
      if (n.kind === "fill" || n.kind === "stroke") {
        out.push(k === 1 ? n : this.pale(n, k));
        continue;
      }
      if (win !== undefined && !meets(n.box, win)) continue;
      if (n.kind === "clip") {
        const inner = this.walk(n.items, u, k, [], win);
        if (inner.length > 0) out.push({ kind: "clip", path: n.path, rule: n.rule, items: inner });
      } else if (u >= n.end) {
        this.walk(n.final ?? n.items, u, k, out, win);
      } else if (u < n.start) {
        continue;
      } else if (n.final !== undefined) {
        this.walk(n.items, u, k, out, win);
      } else {
        const r = reveal(n.sweeps, u);
        if (r.kind === "hidden") continue;
        if (r.kind === "whole") {
          this.walk(n.items, u, k, out, win);
          continue;
        }
        if (r.main !== undefined) {
          const inner = this.walk(n.items, u, k, [], win);
          if (inner.length > 0) out.push({ kind: "clip", path: path(r.main), rule: "nonzero", items: inner });
        }
        if (r.band !== undefined) {
          const inner = this.walk(n.items, u, k * WET, [], win);
          if (inner.length > 0) out.push({ kind: "clip", path: path(r.band), rule: "nonzero", items: inner });
        }
      }
    }
    return out;
  }

  // `it` at a share k of its opacity.
  private pale(it: Fill | Stroke, k: number): Fill | Stroke {
    let m = this.wet.get(it);
    if (m === undefined) {
      m = new Map();
      this.wet.set(it, m);
    }
    let p = m.get(k);
    if (p === undefined) {
      p = { ...it, alpha: it.alpha * k };
      m.set(k, p);
    }
    return p;
  }
}

// When sweep s changes what lies in window `win`, or null for never: a line
// while its pen, its band and its wet front pass through the window; a
// disc while it spreads, if it reaches the window; a gate at its moment.
function sweepIn(s: Sweep, win: Box): [number, number] | null {
  if (s.kind === "gate") return [s.b, s.b];
  if (s.kind === "disc") {
    if (s.x + s.r < win[0] || s.x - s.r > win[2] || s.y + s.r < win[1] || s.y - s.r > win[3]) return null;
    return [s.b, s.b + s.d];
  }
  const pad = s.half + s.wet;
  const n = s.arc.length;
  let i0 = -1, i1 = -1;
  for (let i = 0; i < n; i++) {
    const x = s.pts[2 * i], y = s.pts[2 * i + 1];
    if (x >= win[0] - pad && x <= win[2] + pad && y >= win[1] - pad && y <= win[3] + pad) {
      if (i0 < 0) i0 = i;
      i1 = i;
    }
  }
  if (i0 < 0) return null;
  // The pen's time at each point; from the point before the first inside
  // to where it has gone a band and a wet front past the last.
  const len = s.arc[n - 1];
  const time = (i: number) => (s.times !== undefined ? s.times[i] : s.b + (len > 0 ? (s.arc[i] / len) * s.d : 0));
  let j = Math.min(n - 1, i1 + 1);
  while (j < n - 1 && s.arc[j] < s.arc[i1] + pad) j++;
  return [time(Math.max(0, i0 - 1)), time(j)];
}