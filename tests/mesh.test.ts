// A timeline's mesh (mesh.ts) draws the frames the timeline makes: at any
// growth, walking it draws as many items, as pale, inside as many clips, as
// Timeline.at; finished, it draws every item once with no masks; a window
// keeps what reaches it; and its masks are laid down no later than they
// dry.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fill, Item, Stroke } from "../src/display.ts";
import { compose, Painter } from "../src/engine/index.ts";
import type { FloraSpec } from "../src/engine/frames.ts";
import { flatten } from "../src/flatten.ts";
import { meshOf, walkFrame, MASK, type Mesh } from "../src/mesh.ts";
import { fillTriangles } from "../src/tess.ts";
import { Timeline, type Node } from "../src/timeline.ts";

const lines = Array.from({ length: 39 }, (_, i) => ({ x0: 162, x1: 436, y0: 712 - 12 * i, y1: 720 - 12 * i }));
const SPEC: FloraSpec = { width: 595, height: 842, seed: 6, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, header_y: 760, lines };
const pt = new Painter({ width: 595, height: 842, timed: true });
compose.page(SPEC, { painter: pt });
const tl = new Timeline(pt.scene());
const mesh = meshOf(tl, 1);

// What a frame draws: items by how pale, and clips that hold any item.
interface Drawn { items: Map<number, number>; clips: number }

function ofMesh(m: Mesh, u: number): Drawn {
  const items = new Map<number, number>();
  // Items drawn inside each mask entered, innermost last.
  const held: number[] = [];
  let clips = 0;
  walkFrame(m, u, {
    items: (a, b, pale) => {
      items.set(round(pale), (items.get(round(pale)) ?? 0) + (b - a));
      for (let i = 0; i < held.length; i++) held[i] += b - a;
    },
    enter: () => { held.push(0); },
    leave: () => { if (held.pop()! > 0) clips++; },
  });
  return { items, clips };
}

// The same of Timeline.at(u), its pale copies known by their alpha against
// the finished item's (in order, the finished list has the same items).
function ofTimeline(u: number): Drawn {
  const items = new Map<number, number>();
  let clips = 0;
  const walk = (list: readonly Item[]) => {
    for (const it of list) {
      if (it.kind === "clip") {
        clips++;
        walk(it.items);
      } else if (it.kind !== "image" && covering(it)) {
        const k = round(it.alpha / alphaOf.get(it.path)!);
        items.set(k, (items.get(k) ?? 0) + 1);
      }
    }
  };
  walk(tl.at(u).items);
  return { items, clips };
}

const round = (k: number) => Math.round(k * 1e6) / 1e6;
// Whether a fill covers anything at scale 1: a petal too small to bend
// flattens to a line, which neither renderer draws.
const covers = new WeakMap<object, boolean>();
const covering = (it: Fill | Stroke): boolean => {
  if (it.kind === "stroke") return true;
  let c = covers.get(it.path);
  if (c === undefined) {
    let n = 0;
    fillTriangles(flatten(it.path, { scale: 1, x0: 0, y0: 0 }), it.rule, { push6: () => { n++; } });
    covers.set(it.path, (c = n > 0));
  }
  return c;
};
// Every item the timeline holds (batches' parts and their paintings done
// at once alike), with its alpha by its path (pale copies share the path).
const alphaOf = new Map<unknown, number>();
let held = 0;
const collect = (list: readonly Node[]) => {
  for (const n of list) {
    if (n.kind === "fill" || n.kind === "stroke") {
      alphaOf.set(n.path, n.alpha);
      if (covering(n)) held++;
    } else {
      collect(n.items);
      if (n.kind === "timed" && n.final !== undefined) collect(n.final);
    }
  }
};
collect(tl.root);

test("every item of the timeline that covers anything is in the mesh", () => {
  assert.equal(mesh.count, held);
});

test("at every growth the mesh draws what the timeline draws", () => {
  for (let i = 0; i <= 40; i++) {
    const u = (tl.end * i) / 40;
    const a = ofMesh(mesh, u), b = ofTimeline(u);
    assert.deepEqual([...a.items].sort(), [...b.items].sort(), `items by paleness at u = ${u}`);
    assert.equal(a.clips, b.clips, `clips holding items at u = ${u}`);
  }
});

test("finished, the mesh draws each item once and enters only the page's own clips", () => {
  const counts = new Uint8Array(mesh.count);
  let masks = 0;
  walkFrame(mesh, tl.end, {
    items: (a, b, pale) => {
      assert.equal(pale, 1);
      for (let i = a; i < b; i++) counts[i]++;
    },
    enter: (_f, _c, mode) => { assert.equal(mode, 0, "a growth mask once all is laid down"); masks++; },
    leave: () => {},
  });
  // Batches' parts give way to their paintings done at once.
  const drawn = counts.reduce((n, c) => n + c, 0);
  assert.ok(counts.every((c) => c <= 1), "an item drawn twice");
  assert.equal(drawn, ofTimeline(tl.end).items.get(1));
  assert.ok(masks > 0);
});

test("a window's mesh holds only what reaches it, and draws there as the whole page's does", () => {
  const win = [100, 300, 300, 420] as const;
  const part = meshOf(tl, 1, win);
  assert.ok(part.count < mesh.count / 2, `${part.count} of ${mesh.count} items`);
  for (let i = 0; i < part.verts.length; i += 3) assert.ok(part.verts[i + 2] < part.count);
  // Under the same timeline, the window's frames enter masks only where
  // the whole page's do.
  for (const k of [0.2, 0.5, 0.8]) assert.ok(ofMesh(part, tl.end * k).clips <= ofMesh(mesh, tl.end * k).clips);
});

test("a mask is laid down no later than it dries, and nothing is laid before growth starts", () => {
  const m = mesh.masks;
  let timed = 0;
  for (let i = 0; i < m.length; i += MASK) {
    const band = m[i + 2], main = m[i + 3];
    assert.ok(band <= main, `vertex ${i / MASK}: band ${band} after main ${main}`);
    if (band > -1e29) {
      timed++;
      // Times are kept as float32.
      assert.ok(band >= 0 && main <= Math.fround(tl.end) * (1 + 1e-6), `vertex ${i / MASK}: ${band}-${main} outside 0-${tl.end}`);
    }
  }
  assert.ok(timed > 0);
});
