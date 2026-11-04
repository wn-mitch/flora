// The sweeps a lay makes (Painter.lay, timeline.ts): where and when each
// part of a painting is laid down, worked out from the generator's own
// coordinates into the scene's.
import type { Pt } from "./geom.ts";
import type { Projection, SceneItem, Sweep } from "./paint.ts";

// How a part of the painting is laid down (Painter.lay), in the
// generator's coordinates and pt of growth. It starts `start` after the
// front reaches `at`, or after the start of the lay it is painted inside
// (0 outside any), and takes `dur`:
//   along   swept along this line by a band `half` either side; given
//           `at` and no `dur`, the pen starts from the end of the line the
//           front reaches first and reaches each point as the front does
//           (never going back), otherwise it moves evenly over dur, by
//           default the line's length
//   from    spread out from this point ("middle": the middle of what is
//           painted) to `reach` (by default as far as anything painted
//           reaches); dur defaults to PACE times reach
//   neither shown whole at once
// `wet` is the width of the paler wet front behind the pen.
export interface Lay {
  readonly at?: Pt;
  readonly start?: number;
  readonly dur?: number;
  readonly along?: readonly Pt[];
  readonly half?: number;
  readonly from?: Pt | "middle";
  readonly reach?: number;
  readonly wet?: number;
}

// Growth a spreading lay takes per pt of reach, by default.
const PACE = 1.5;
// Points no further apart than this along a lay's line, so its pen keeps
// pace with the front and its stretches of change stay local.
const STEP = 8;

// What a painter knows of where it paints: when the front reaches a point
// (none: lays start at `base`), the start of the lay being painted, the
// map every point passes through, and the page's height (scenes run y
// down).
export interface Where {
  readonly births: ((this: void, x: number, y: number) => number) | undefined;
  readonly base: number;
  readonly map: Projection | undefined;
  readonly height: number;
}

// The sweeps of lays `list`, but for those spreading from a point, which
// need what is painted first (spreads); and the earliest start among them
// all, which lays painted inside count from.
export function sweeps(list: readonly Lay[], w: Where): { sweeps: Sweep[]; later: [number, Lay][]; first: number } {
  const out: Sweep[] = [];
  const later: [number, Lay][] = [];
  let first = Infinity;
  const births = w.births;
  for (const l of list) {
    const b = (l.at !== undefined && births !== undefined ? births(l.at[0], l.at[1]) : w.base) + (l.start ?? 0);
    first = Math.min(first, b);
    if (l.along !== undefined) {
      const paced = l.at !== undefined && l.dur === undefined && births !== undefined;
      let along = finely(l.along);
      if (paced && births !== undefined && along.length > 1) {
        const a = along[0], z = along[along.length - 1];
        if (births(z[0], z[1]) < births(a[0], a[1])) along = along.slice().reverse();
      }
      const pts = scenePoints(along, w);
      const arc = [0];
      for (let i = 1; i < pts.length / 2; i++) {
        const dx = pts[2 * i] - pts[2 * i - 2], dy = pts[2 * i + 1] - pts[2 * i - 1];
        arc.push(arc[i - 1] + Math.sqrt(dx * dx + dy * dy));
      }
      if (pts.length < 4) {
        out.push({ kind: "gate", b, d: 0 });
        continue;
      }
      if (paced && births !== undefined) {
        const times: number[] = [];
        let t = births(along[0][0], along[0][1]) + (l.start ?? 0);
        const b0 = t;
        for (const p of along) {
          t = Math.max(t, births(p[0], p[1]) + (l.start ?? 0));
          times.push(t);
        }
        first = Math.min(first, b0);
        out.push({ kind: "line", b: b0, d: times[times.length - 1] - b0, pts, arc, half: l.half ?? 1, wet: l.wet ?? 0, times });
        continue;
      }
      out.push({ kind: "line", b, d: l.dur ?? arc[arc.length - 1], pts, arc, half: l.half ?? 1, wet: l.wet ?? 0 });
    } else if (l.from !== undefined) {
      later.push([b, l]);
    } else {
      out.push({ kind: "gate", b, d: 0 });
    }
  }
  if (first === Infinity) {
    first = w.base;
    if (later.length === 0) out.push({ kind: "gate", b: first, d: 0 });
  }
  return { sweeps: out, later, first };
}

// The sweeps of lays spreading from a point, [start, lay] pairs, over what
// was painted, `items`; one from "middle" over nothing makes none.
export function spreads(later: readonly [number, Lay][], items: readonly SceneItem[], map: Projection | undefined, height: number): Sweep[] {
  const out: Sweep[] = [];
  for (const [b, l] of later) {
    let x: number, y: number;
    const from = l.from;
    if (from === "middle" || from === undefined) {
      const box = boxOf(items);
      if (box === undefined) continue;
      x = (box[0] + box[2]) / 2;
      y = (box[1] + box[3]) / 2;
    } else {
      const q = map === undefined ? from : map(from[0], from[1]);
      x = q[0];
      y = height - q[1];
    }
    const r = l.reach ?? reachOf(items, x, y);
    out.push({ kind: "disc", b, d: l.dur ?? PACE * r, x, y, r, wet: l.wet ?? 0 });
  }
  return out;
}

// Points `line` in the scene, flat [x0, y0, x1, y1, ...].
function scenePoints(line: readonly Pt[], w: Where): number[] {
  const pts: number[] = [];
  const pj = w.map;
  for (const p of line) {
    const q = pj === undefined ? p : pj(p[0], p[1]);
    pts.push(q[0], w.height - q[1]);
  }
  return pts;
}

// `line` with points put in along any side longer than STEP.
function finely(line: readonly Pt[]): readonly Pt[] {
  let long = false;
  for (let i = 1; i < line.length && !long; i++) {
    const dx = line[i][0] - line[i - 1][0], dy = line[i][1] - line[i - 1][1];
    if (dx * dx + dy * dy > STEP * STEP) long = true;
  }
  if (!long) return line;
  const out: Pt[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const n = Math.ceil(Math.sqrt(dx * dx + dy * dy) / STEP);
    for (let k = 1; k <= n; k++) out.push(k === n ? b : [a[0] + (dx * k) / n, a[1] + (dy * k) / n]);
  }
  return out;
}

// How far from (x, y) anything in `items` reaches, scene units: path
// points, and strokes' half widths beyond them.
function reachOf(items: readonly SceneItem[], x: number, y: number): number {
  let r = 0;
  for (const it of items) {
    if (it.kind === "clip" || it.kind === "timed") {
      r = Math.max(r, reachOf(it.items, x, y));
      continue;
    }
    const c = it.path.coords;
    let far = 0;
    for (let i = 0; i + 1 < c.length; i += 2) {
      const dx = c[i] - x, dy = c[i + 1] - y;
      far = Math.max(far, dx * dx + dy * dy);
    }
    r = Math.max(r, Math.sqrt(far) + (it.kind === "stroke" ? it.width / 2 : 0));
  }
  return r;
}

// The box [x0, y0, x1, y1] round every path point in `items`, or undefined
// when they have none.
function boxOf(items: readonly SceneItem[]): [number, number, number, number] | undefined {
  let box: [number, number, number, number] | undefined;
  for (const it of items) {
    if (it.kind === "clip" || it.kind === "timed") {
      const b = boxOf(it.items);
      if (b !== undefined) box = box === undefined ? b : [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
      continue;
    }
    const c = it.path.coords;
    for (let i = 0; i + 1 < c.length; i += 2) {
      if (box === undefined) box = [c[i], c[i + 1], c[i], c[i + 1]];
      else box = [Math.min(box[0], c[i]), Math.min(box[1], c[i + 1]), Math.max(box[2], c[i]), Math.max(box[3], c[i + 1])];
    }
  }
  return box;
}
