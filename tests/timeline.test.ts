// A Timeline's frames are the engine's frames (engine/timeline.ts frame) as
// display lists, number for number; a window leaves out only what lies
// outside it; and a window's stretches of change are in order, apart and
// within the page's growth.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayList, Item } from "../src/display.ts";
import { compose, Painter, timeline as TL } from "../src/engine/index.ts";
import type { FloraSpec } from "../src/engine/frames.ts";
import { pathBox } from "../src/flatten.ts";
import { toDisplayList } from "../src/scene.ts";
import { Timeline } from "../src/timeline.ts";

const lines = Array.from({ length: 39 }, (_, i) => ({ x0: 162, x1: 436, y0: 712 - 12 * i, y1: 720 - 12 * i }));
const SPEC: FloraSpec = { width: 595, height: 842, seed: 6, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
const pt = new Painter({ width: 595, height: 842, timed: true });
compose.page(SPEC, { painter: pt });
const scene = pt.scene();
const tl = new Timeline(scene);

// Every number in a display list, in order, with a marker per item kind.
function numbers(items: readonly Item[], out: number[] = []): number[] {
  for (const it of items) {
    if (it.kind === "image") throw new Error("no images here");
    out.push(it.kind === "fill" ? 1 : it.kind === "stroke" ? 2 : 3);
    for (const v of it.path.verbs) out.push(v);
    for (const c of it.path.coords) out.push(c);
    if (it.kind === "clip") numbers(it.items, out);
    else out.push(it.alpha);
  }
  return out;
}

function sameNumbers(a: number[], b: number[], what: string): void {
  assert.equal(a.length, b.length, `${what}: lengths`);
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${what}: number ${i} is ${a[i]}, want ${b[i]}`);
}

test("a timeline's frames are the engine's frames, and its end the engine's", () => {
  assert.equal(tl.end, TL.end(scene.items));
  for (const k of [0, 0.05, 0.2, 0.37, 0.5, 0.81, 0.99, 1, 1.5]) {
    const u = tl.end * k;
    const want = toDisplayList({ width: 595, height: 842, items: TL.frame(scene.items, u) });
    sameNumbers(numbers(tl.at(u).items), numbers(want.items), `at ${k}`);
  }
});

test("the last frame is the finished page", () => {
  sameNumbers(numbers(tl.at(tl.end).items), numbers(toDisplayList(scene).items), "finished");
});

// The box of everything a list's items paint, or null.
function reach(items: readonly Item[]): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null;
  for (const it of items) {
    if (it.kind === "image") continue;
    const b = pathBox(it.path);
    if (b === null) continue;
    const w = it.kind === "stroke" ? it.width / 2 : 0;
    box = box === null ? [b[0] - w, b[1] - w, b[2] + w, b[3] + w] : [Math.min(box[0], b[0] - w), Math.min(box[1], b[1] - w), Math.max(box[2], b[2] + w), Math.max(box[3], b[3] + w)];
  }
  return box;
}

// Every fill and stroke in `items` with the box it can paint: its own,
// cut to the boxes of the clips it is inside.
function leaves(items: readonly Item[], clip: readonly number[] = [-Infinity, -Infinity, Infinity, Infinity], out = new Map<Item, number[]>()): Map<Item, number[]> {
  for (const it of items) {
    if (it.kind === "image") continue;
    const b = pathBox(it.path);
    if (b === null) continue;
    const w = it.kind === "stroke" ? it.width / 2 : 0;
    const box = [Math.max(clip[0], b[0] - w), Math.max(clip[1], b[1] - w), Math.min(clip[2], b[2] + w), Math.min(clip[3], b[3] + w)];
    if (it.kind === "clip") leaves(it.items, box, out);
    else out.set(it, box);
  }
  return out;
}

test("a window leaves out only what cannot reach it", () => {
  const win = [0, 300, 160, 500] as const;
  for (const k of [0.3, 0.6, 1]) {
    const u = tl.end * k;
    const all = leaves(tl.at(u).items), part = leaves(tl.at(u, win).items);
    assert.ok(part.size < all.size, `at ${k} the window leaves something out`);
    for (const [it, b] of all) {
      if (part.has(it) || b[0] > b[2] || b[1] > b[3]) continue;
      assert.ok(b[2] < win[0] || b[0] > win[2] || b[3] < win[1] || b[1] > win[3], `at ${k} an item reaching the window was left out: ${b.join(", ")}`);
    }
  }
});

test("a window changes only within its stretches of growth", () => {
  const win = [0, 300, 160, 500] as const;
  const ch = tl.changes(win);
  assert.ok(ch.length > 0, "something grows there");
  for (let i = 1; i < ch.length; i++) assert.ok(ch[i][0] > ch[i - 1][1], "in order, apart");
  const last = ch[ch.length - 1][1];
  assert.ok(last <= tl.end, "within the page's growth");
  // That frames are alike between stretches is a matter of pixels:
  // tests/render.browser.ts draws them.
  assert.deepEqual(tl.changes([10000, 10000, 10001, 10001]), [], "a window off the page never changes");
  // Leaving out the batches' switches leaves stretches within those that
  // keep them, and fewer moments.
  const lean = tl.changes(win, { final: false });
  for (const [a, b] of lean) assert.ok(ch.some(([c, d]) => c <= a && b <= d), `${a}..${b} lies within a stretch`);
  const instants = (l: [number, number][]) => l.filter(([a, b]) => a === b).length;
  assert.ok(instants(lean) < instants(ch), "the batches' switches are left out");
});
