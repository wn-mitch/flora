// A plant painted with its timeline (timeline.ts) paints exactly what it
// paints without one; its frames go from nothing to the finished page,
// each part only ever further along; sweeps cover what lies behind the pen
// and nothing ahead of it; and a frame's clips nest no deeper than the
// WebGL renderer draws.
import { fmt } from "#platform";
import * as C from "../../src/engine/compose.ts";
import type { FloraSpec } from "../../src/engine/frames.ts";
import * as G from "../../src/engine/geom.ts";
import { PAL, Painter, type SceneItem, type Sweep } from "../../src/engine/paint.ts";
import * as TL from "../../src/engine/timeline.ts";
import { check, eq, eqList, near, test, throws } from "./harness.ts";
import { bodySpec, covers, numbers } from "./scenes.ts";

const SPEC: FloraSpec = { ...bodySpec(), seed: 4 };

function timedPage(spec: FloraSpec = SPEC): SceneItem[] {
  const pt = new Painter({ width: spec.width, height: spec.height, timed: true });
  C.page(spec, { painter: pt });
  return pt.scene().items;
}

function plainPage(spec: FloraSpec = SPEC): SceneItem[] {
  return C.page(spec, { painter: new Painter({ width: spec.width, height: spec.height }) }).pt.scene().items;
}

// Every timed group in `items`, outermost first.
function groups(items: readonly SceneItem[], out: { sweeps: Sweep[]; items: SceneItem[] }[] = []): { sweeps: Sweep[]; items: SceneItem[] }[] {
  for (const it of items) {
    if (it.kind === "timed") out.push(it);
    if (it.kind === "timed" || it.kind === "clip") groups(it.items, out);
  }
  return out;
}

function depth(items: readonly SceneItem[]): number {
  let d = 0;
  for (const it of items) if (it.kind === "clip" || it.kind === "timed") d = Math.max(d, (it.kind === "clip" ? 1 : 0) + depth(it.items));
  return d;
}

// Fills and strokes in `items`, inside clips too.
function painted(items: readonly SceneItem[]): number {
  let n = 0;
  for (const it of items) n += it.kind === "fill" || it.kind === "stroke" ? 1 : painted(it.items);
  return n;
}

const timed = timedPage();
const end = TL.end(timed);

test("a page painted with its timeline paints exactly what it paints without", () => {
  eqList(numbers(timed), numbers(plainPage()), "the same numbers in the same order");
  check(groups(timed).length > 100, "the page is laid down in many parts");
});

// A title page's text, as tikz-flora sets one.
const lines = (n: number, top: number, step: number, x0: number, x1: number, h: number) =>
  Array.from({ length: n }, (_, i) => ({ x0, x1, y0: top - step * i, y1: top - step * i + h }));
const TITLE: FloraSpec = { ...SPEC, seed: 7, lines: [...lines(3, 690, 30, 200, 398, 20), ...lines(26, 520, 14, 162, 436, 9)] };

test("nothing is painted outside a timed group, so nothing shows before it is laid down", () => {
  for (const it of timed) check(it.kind === "timed", `a top-level ${it.kind} outside any lay`);
  // Layouts paint their own furniture under and over the plants.
  for (const layout of ["title", "bouquet", "scrollwork"]) {
    const items = timedPage({ ...TITLE, layout });
    for (const it of items) check(it.kind === "timed", `${layout}: a top-level ${it.kind} outside any lay`);
    eqList(numbers(items), numbers(plainPage({ ...TITLE, layout })), `${layout}: the same page`);
  }
});

test("no long line of a page is laid down all at once", () => {
  // A paced line drawn from the end the front reaches last would pop in
  // whole when the front got there.
  for (const spec of [SPEC, { ...SPEC, width: 200, height: 3000, seed: 9, text: { x0: 170, y0: 24, x1: 200, y1: 2976 }, lines: [{ x0: 170, y0: 24, x1: 200, y1: 2976 }], budget: 1 }]) {
    for (const g of groups(timedPage(spec))) {
      for (const s of g.sweeps) {
        if (s.kind !== "line" || s.arc[s.arc.length - 1] < 40) continue;
        check(s.d > 0, "a line " + fmt(s.arc[s.arc.length - 1], 0) + " pt long laid down at once at " + fmt(s.b, 0));
      }
    }
  }
});

test("frames run from nearly nothing to the finished page", () => {
  check(end > 300, "the page takes a while to lay down");
  const first = TL.frame(timed, 0);
  check(painted(first) < painted(timed) * 0.02, "at growth 0 next to nothing shows");
  eqList(numbers(TL.frame(timed, end)), numbers(TL.finished(timed)), "at the end, the finished page");
  eqList(numbers(TL.frame(timed, end * 2)), numbers(TL.finished(timed)), "and so after it");
  let last = -1;
  for (const k of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const n = painted(TL.frame(timed, end * k));
    check(n >= last * 0.9, "the painting fills in as it grows");
    last = n;
  }
});

test("each part goes hidden, then partly laid down, then whole, never back", () => {
  const rank = { hidden: 0, clipped: 1, whole: 2 };
  const us: number[] = [];
  for (let i = 0; i <= 60; i++) us.push((end * i) / 60);
  for (const g of groups(timed)) {
    let r = 0;
    for (const u of us) {
      const now = rank[TL.reveal(g.sweeps, u).kind];
      check(now >= r, "a part never goes back");
      r = now;
    }
    eq(r, 2, "every part is whole at the end");
  }
});

test("a frame's clips nest at most three deep, as WebGL draws them", () => {
  check(depth(TL.finished(timed)) <= 2, "the finished page leaves room for a sweep");
  for (let i = 1; i < 40; i++) check(depth(TL.frame(timed, (end * i) / 40)) <= 3, "frame " + fmt(i, 0) + " of 40 nests too deep");
});

test("a line sweep covers the line behind the pen, wet just behind it, and nothing ahead", () => {
  const pt = new Painter({ width: 200, height: 200, timed: true });
  const line: [number, number][] = [[20, 100], [100, 100], [100, 180]];
  pt.lay([{ along: line, half: 6, wet: 20 }], () => pt.stroke(G.polyline(line, false), PAL.ink, 4));
  const items = pt.scene().items;
  const g = items[0];
  if (g.kind !== "timed") throw new Error("a timed group");
  const s = g.sweeps[0];
  eq(s.kind, "line", "a line sweep");
  near(TL.done(s), 160, 1e-9, "it takes the line's length");
  // In scene coordinates (y down) the second leg runs up from (100, 100)
  // to (100, 20). At 120 the pen is 40 pt up it, at (100, 60), and the
  // wet stretch is the 20 pt behind it.
  const r = TL.reveal(g.sweeps, 120);
  if (r.kind !== "clipped" || r.main === undefined || r.band === undefined) throw new Error("partly laid, with a wet band");
  check(covers(r.main, 30, 100), "the start");
  check(covers(r.main, 103, 103), "round the corner, outside it too");
  check(covers(r.main, 104, 85), "up the second leg, within the band");
  check(!covers(r.main, 100, 70), "the wet stretch is not in the main clip");
  check(covers(r.band, 100, 70), "the wet stretch, behind the pen");
  check(covers(r.band, 100, 56), "the pen's round tip");
  check(!covers(r.band, 100, 90), "the wet band stops where the main clip starts");
  check(!covers(r.main, 100, 45) && !covers(r.band, 100, 45), "nothing ahead of the pen");
  check(!covers(r.main, 60, 110), "nothing beyond the band");
  eq(TL.reveal(g.sweeps, 0).kind, "hidden", "hidden at the start");
  eq(TL.reveal(g.sweeps, 160).kind, "whole", "whole once the pen reaches the end");
});

test("a line laid from a place on the plant keeps pace with the front, never going back", () => {
  const pt = new Painter({ width: 200, height: 200, timed: true });
  // The front reaches x at 2x, except a dip it must not follow back.
  pt.births = (x: number) => (x > 60 && x < 80 ? 20 : x * 2);
  const line: [number, number][] = [];
  for (let x = 10; x <= 150; x += 10) line.push([x, 100]);
  pt.lay([{ at: line[0], along: line, half: 3 }], () => pt.stroke(G.polyline(line, false), PAL.ink, 1));
  const g = pt.scene().items[0];
  if (g.kind !== "timed") throw new Error("a timed group");
  const s = g.sweeps[0];
  if (s.kind !== "line" || s.times === undefined) throw new Error("a paced line");
  eq(s.b, 20, "it starts when the front reaches its first point");
  eq(s.d, 280, "and ends when the front reaches its last");
  for (let i = 1; i < s.times.length; i++) check(s.times[i] >= s.times[i - 1], "the pen never goes back");
  const r = TL.reveal(g.sweeps, 200);
  if (r.kind !== "clipped" || r.main === undefined) throw new Error("partway");
  // At 200 the front is at x = 100 (scene y is 100 too).
  check(covers(r.main, 95, 100), "behind the front");
  check(!covers(r.main, 110, 100), "not ahead of it");
});

test("a lay from a point spreads to what it paints, and starts when the front reaches it", () => {
  const pt = new Painter({ width: 100, height: 100, timed: true });
  pt.births = (x: number) => x * 2;
  pt.lay([{ at: [30, 50], from: [30, 50] }], () => pt.fill([["o", 30, 50, 10]], PAL.blue));
  const g = pt.scene().items[0];
  if (g.kind !== "timed") throw new Error("a timed group");
  const s = g.sweeps[0];
  if (s.kind !== "disc") throw new Error("a disc");
  eq(s.b, 60, "born when the front reaches (30, 50)");
  // The circle's Bezier control points stand a little outside it.
  check(s.r >= 10 && s.r < 12, "it reaches the circle's edge");
  const r = TL.reveal(g.sweeps, s.b + s.d / 2);
  if (r.kind !== "clipped" || r.main === undefined) throw new Error("spreading");
  check(covers(r.main, 30, 50), "the middle first");
  check(!covers(r.main, 39.9, 50), "not yet the edge");
});

test("lays nested inside lays start from the outer lay's start", () => {
  const pt = new Painter({ width: 100, height: 100, timed: true });
  pt.births = () => 40;
  pt.lay([{ at: [0, 0] }], () => {
    eq(pt.start, 40, "the outer start");
    pt.lay([{ start: 5, along: [[0, 0], [10, 0]] }], () => pt.fill([["o", 5, 0, 1]], PAL.ink));
  });
  eq(pt.start, 0, "restored");
  const inner = groups(pt.scene().items)[1];
  eq(inner.sweeps[0].b, 45, "5 after the outer start");
});

test("a painter not keeping the timeline paints a lay's contents in place", () => {
  const pt = new Painter({ width: 100, height: 100 });
  pt.lay([{ along: [[0, 0], [10, 0]] }], () => pt.fill([["o", 5, 0, 1]], PAL.ink));
  const items = pt.scene().items;
  eq(items.length, 1, "one item");
  eq(items[0].kind, "fill", "the fill itself");
});

test("recorded frames what it painted, and a lay must close what it opens", () => {
  const pt = new Painter({ width: 100, height: 100 });
  pt.fill([["o", 1, 1, 1]], PAL.ink);
  pt.recorded(() => {
    pt.lay([{ start: 10 }], () => pt.fill([["o", 5, 5, 1]], PAL.ink));
    pt.lay([{ start: 30 }], () => pt.fill([["o", 6, 6, 1]], PAL.ink));
  }, (items) => TL.frame(items, 20));
  eq(pt.timed, false, "the painter's own setting is restored");
  const items = pt.scene().items;
  eq(items.length, 2, "what came before, and the one part laid down by 20");
  // The circle round (5, 5) starts at (6, 5).
  eq(items[1].kind === "fill" ? items[1].path.coords[0] : -1, 6, "the part started at 10");
  const open = new Painter({ width: 9, height: 9, timed: true });
  throws(() => open.lay([{}], () => open.clipBegin([["o", 1, 1, 1]])), "left a clip open", "a clip left open inside a lay");
});

test("a growth frame of a page is the timeline's frame at that share of its end", () => {
  const half = C.page({ ...SPEC, grow: 0.5 }, { painter: new Painter({ width: SPEC.width, height: SPEC.height }) }).pt.scene().items;
  eqList(numbers(half), numbers(TL.frame(timed, end * 0.5)), "the same frame");
  check(painted(half) < painted(timed), "less than the finished page");
});
