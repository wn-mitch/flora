// Gardens grown online (src/grow): the same seed and region grow the same
// garden however its ticks are batched; paint stays in the region, out of
// what is closed and, but for stems, out of where only stems run; nothing
// starts before the ink of the stem it grows from reaches it, and no
// floret before its stalk's; one hero per garden; growth settles, reaches
// the foot of a tall region and fills it down its length; and the first
// stroke shows within a few ticks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Garden, type GardenOptions, type Piece } from "../src/grow/index.ts";
import { sprayLays } from "../src/grow/pieces.ts";
import { sprig as S, Rng } from "../src/engine/index.ts";
import type { Pt } from "../src/engine/geom.ts";
import { flatten } from "../src/flatten.ts";
import type { Item } from "../src/display.ts";

const margin = (h: number, seed: number | string, more: Partial<GardenOptions> = {}): GardenOptions =>
  ({ width: 300, height: h, open: [[0, 0, 270, h]], root: [210, h - 4], heading: -Math.PI / 2, seed, ...more });

// Grow to the end in steps of `by` ticks; every piece, in the order laid down.
function grow(o: GardenOptions, by = 50, most = 60000): { g: Garden; pieces: Piece[] } {
  const g = new Garden(o);
  const pieces: Piece[] = [];
  while (!g.done && g.tick < most) {
    g.step(by);
    pieces.push(...g.takeFinished());
  }
  return { g, pieces };
}

const digest = (ps: readonly Piece[]) => ps.map((p) => `${p.id}:${p.kind}:${p.start}:${p.end}:${p.box.map((v) => v.toFixed(3)).join(",")}`).join("\n");

// Every painted point of a piece, page pt (y up); a clip counts by its own
// outline, as nothing inside it paints past it.
function points(p: Piece, h: number, fn: (x: number, y: number) => void): void {
  const walk = (items: readonly Item[]) => {
    for (const it of items) {
      if (it.kind === "image") continue;
      for (const sub of flatten(it.path, { scale: 1, x0: 0, y0: 0 })) for (let i = 0; i < sub.length; i += 2) fn(sub[i], h - sub[i + 1]);
    }
  };
  walk(p.tl.at(Infinity).items);
}

test("a garden grows alike one tick at a time or many, and another seed grows another", () => {
  const o = margin(900, 3);
  const one = grow(o, 1).pieces, some = grow(o, 13).pieces, many = grow(o, 500).pieces;
  assert.ok(one.length > 40, `${one.length} pieces`);
  assert.equal(digest(some), digest(one));
  assert.equal(digest(many), digest(one));
  assert.notEqual(digest(grow(margin(900, 4)).pieces), digest(one));
});

test("paint stays in the region, out of what is closed, and only stems run where only stems may", () => {
  const H = 2400;
  const closed = [60, 1500, 270, 1700] as const, stems = [0, 900, 270, 960] as const;
  for (const seed of [1, 2, 3]) {
    const { pieces } = grow(margin(H, seed, { closed: [closed], stems: [stems] }));
    // A stem's edge may lie half its width past the line it runs along.
    const slack = 2.5;
    let crossed = 0;
    for (const p of pieces) {
      points(p, H, (x, y) => {
        assert.ok(x >= -slack && x <= 270 + slack && y >= -slack && y <= H + slack, `seed ${seed}: ${p.kind} ${p.id} paints at (${x.toFixed(1)}, ${y.toFixed(1)})`);
        const inside = (r: readonly number[], m: number) => x > r[0] + m && x < r[2] - m && y > r[1] + m && y < r[3] - m;
        assert.ok(!inside(closed, slack), `seed ${seed}: ${p.kind} ${p.id} paints in the closed box at (${x.toFixed(1)}, ${y.toFixed(1)})`);
        if (inside(stems, slack)) {
          assert.equal(p.kind, "stem", `seed ${seed}: a ${p.kind} where only stems run`);
          crossed++;
        }
      });
    }
    assert.ok(crossed > 0, `seed ${seed}: no stem runs on through the band`);
  }
});

test("nothing starts before the ink of the stem it grows from reaches it", () => {
  const { pieces } = grow(margin(2400, 5));
  const stems = pieces.filter((p) => p.kind === "stem");
  const H = 2400;
  let checked = 0;
  for (const p of pieces) {
    if (p.kind === "stem" || p.kind === "gilt") continue;
    // A stretch of stem through the point it grows from, started by then.
    const x = p.at[0], y = H - p.at[1];
    const from = stems.filter((s) => s.box[0] - 3 <= x && x <= s.box[2] + 3 && s.box[1] - 3 <= y && y <= s.box[3] + 3);
    assert.ok(from.length > 0, `${p.kind} ${p.id} grows from no stem`);
    assert.ok(from.some((s) => s.start <= p.start), `${p.kind} ${p.id} starts at ${p.start}, before any stem through it (${from.map((s) => s.start)})`);
    checked++;
  }
  assert.ok(checked > 50, `${checked} pieces checked`);
});

test("a spray's florets open only once their stalk's ink reaches them, its lines after those they leave", () => {
  for (const seed of [1, 2, 3, 4]) {
    const b = new S.Batch();
    const root: Pt = [100, 100];
    S.gypsophila(b, new Rng(seed), root, 1.2, 40, 5);
    const lays = sprayLays(b, root);
    const lines = lays.filter((l) => l.along !== undefined);
    const opens = lays.filter((l) => l.from !== undefined);
    assert.ok(opens.length > 5 && lines.length > 5);
    // Lines from the root start at once; every other line after some line.
    const len = (pts: readonly Pt[]) => pts.reduce((s, q, i) => (i === 0 ? 0 : s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1])), 0);
    for (const l of lines) {
      const p0 = l.along![0];
      if (Math.hypot(p0[0] - root[0], p0[1] - root[1]) < 2) assert.equal(l.start, 0);
      else assert.ok((l.start ?? 0) > 0, `a line away from the root starts at once`);
    }
    for (const o of opens) {
      const q = o.from as Pt;
      // The line it sits at the end of: the floret opens once its ink is there.
      const host = lines.find((l) => { const e = l.along![l.along!.length - 1]; return Math.hypot(e[0] - q[0], e[1] - q[1]) < 0.5; });
      if (host === undefined) continue;
      assert.ok((o.start ?? 0) >= (host.start ?? 0) + len(host.along!) - 1e-6, `seed ${seed}: a floret opens at ${o.start}, before its stalk's ink at ${(host.start ?? 0) + len(host.along!)}`);
      assert.ok((o.start ?? 0) > 0);
    }
  }
});

test("each garden has one hero, settles, and reaches the foot of a tall region, full down its length", () => {
  for (const seed of [6, 7]) {
    const H = 6000;
    const { g, pieces } = grow(margin(H, seed));
    assert.ok(g.done, `seed ${seed}: still growing at tick ${g.tick}`);
    assert.equal(pieces.filter((p) => p.kind === "hero").length, 1, `seed ${seed}: heroes`);
    assert.ok(g.reach >= H - 40, `seed ${seed}: the ink reaches ${g.reach.toFixed(0)} of ${H}`);
    // Every 600 pt down holds a share of what grew, not just stems.
    for (let y = 0; y + 600 <= H; y += 600) {
      const n = pieces.filter((p) => p.kind !== "stem" && p.kind !== "gilt" && p.box[1] < y + 600 && p.box[3] > y).length;
      assert.ok(n >= 8, `seed ${seed}: ${n} leaves, sprays and blooms in rows ${y}-${y + 600}`);
    }
  }
});

test("the first stroke shows within a few ticks, however tall the region", () => {
  for (const H of [1000, 15000]) {
    const t0 = performance.now();
    const g = new Garden(margin(H, 2));
    let tick = 0;
    while (g.live().length === 0 && tick < 50) {
      g.step(1);
      tick++;
    }
    const ms = performance.now() - t0;
    assert.ok(tick <= 8, `${H} pt: first stroke at tick ${tick}`);
    assert.ok(ms < 150, `${H} pt: ${ms.toFixed(0)} ms to the first stroke`);
  }
});
