// The tikz-flora scene reader: every operator lands where PDF puts it, and
// anything it does not know stops it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPdfScene, OPERATORS, type PdfScene } from "../src/pdf-scene.ts";
import { CLOSE, CUBIC, LINE, MOVE, stats, type Clip, type Fill, type Image, type Stroke } from "../src/display.ts";

const H = 100;
const scene = (content: string, extra: Partial<PdfScene> = {}): PdfScene => ({
  width: 200, height: H, content,
  gs: { a: [0.5, 0.25, "Multiply"], s: [1, 1, "Screen"], bad: [1, 1, "Overlay"] },
  patterns: { p: { coords: [10, 20, 30, 40], stops: [[0, 1, 0, 0], [1, 0, 0, 1]] } },
  ...extra,
});

test("a fill keeps its state, flips y, and closes", () => {
  const list = fromPdfScene(scene("q /a gs 0.1 0.2 0.3 rg 10 20 m 30 20 l 30 40 l h f* Q"));
  assert.equal(list.items.length, 1);
  const f = list.items[0] as Fill;
  assert.equal(f.kind, "fill");
  assert.deepEqual(f.paint, { kind: "solid", rgb: [0.1, 0.2, 0.3] });
  assert.equal(f.rule, "evenodd");
  assert.equal(f.alpha, 0.5);
  assert.equal(f.blend, "multiply");
  assert.deepEqual([...f.path.verbs], [MOVE, LINE, LINE, CLOSE]);
  assert.deepEqual([...f.path.coords], [10, 80, 30, 80, 30, 60]);
});

test("a stroke takes the stroke opacity, colour and width", () => {
  const list = fromPdfScene(scene("q /a gs 0.5 0.5 0.5 RG 2 w 1 J 1 j 0 0 m 10 10 20 10 30 0 c S Q"));
  const s = list.items[0] as Stroke;
  assert.equal(s.kind, "stroke");
  assert.equal(s.alpha, 0.25);
  assert.equal(s.width, 2);
  assert.deepEqual(s.rgb, [0.5, 0.5, 0.5]);
  assert.deepEqual([...s.path.verbs], [MOVE, CUBIC]);
  assert.deepEqual([...s.path.coords], [0, 100, 10, 90, 20, 90, 30, 100]);
});

test("a clip holds what its q paints after it, and no more", () => {
  const list = fromPdfScene(scene(
    "q 0 0 m 50 0 l 50 50 l h W n 1 0 0 rg 0 0 m 5 0 l 5 5 l h f q 0 0 1 rg 1 1 m 2 1 l 2 2 l h f Q Q 0 1 0 rg 0 0 m 9 0 l 9 9 l h f"));
  assert.equal(list.items.length, 2);
  const clip = list.items[0] as Clip;
  assert.equal(clip.kind, "clip");
  assert.equal(clip.items.length, 2, "both fills inside the q are clipped, the nested q's too");
  assert.equal((list.items[1] as Fill).kind, "fill", "the fill after Q is outside the clip");
  assert.deepEqual((list.items[1] as Fill).paint, { kind: "solid", rgb: [0, 1, 0] }, "Q restored the colour set before the clip");
  assert.equal(stats(list).depth, 1);
});

test("clips inside clips nest", () => {
  const list = fromPdfScene(scene("q 0 0 m 9 0 l 9 9 l h W n q 1 1 m 8 1 l 8 8 l h W n 2 2 m 3 2 l 3 3 l h f Q Q"));
  assert.equal(stats(list).depth, 2);
  assert.equal(((list.items[0] as Clip).items[0] as Clip).items.length, 1);
});

test("a gradient is in page space, turned to y down", () => {
  const list = fromPdfScene(scene("q 2 0 0 2 0 0 cm /Pattern cs /p scn 0 0 m 1 0 l 1 1 l h f Q"));
  const f = list.items[0] as Fill;
  assert.deepEqual(f.paint, { kind: "linear", from: [10, 80], to: [30, 60], stops: [{ offset: 0, rgb: [1, 0, 0] }, { offset: 1, rgb: [0, 0, 1] }] });
  // The path itself is under the CTM.
  assert.deepEqual([...f.path.coords], [0, 100, 2, 100, 2, 98]);
});

test("an image's unit square lands on its box, first row on top", () => {
  // 2x1 image placed over x 10..50, y (page, up) 20..30.
  const rgba = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]).toString("base64");
  const list = fromPdfScene(scene("q /s gs 40 0 0 10 10 20 cm /im Do Q", { images: { im: { w: 2, h: 1, rgba } } }));
  const im = list.items[0] as Image;
  const [a, b, c, d, e, f] = im.transform;
  const at = (u: number, v: number) => [a * u + c * v + e, b * u + d * v + f];
  assert.deepEqual(at(0, 0), [10, 70], "u=0, v=0 is the top left: page y 30 is 70 down");
  assert.deepEqual(at(1, 1), [50, 80], "u=1, v=1 is the bottom right: page y 20 is 80 down");
  assert.equal(im.blend, "screen");
  assert.deepEqual([...im.rgba], [255, 0, 0, 255, 0, 0, 255, 255]);
});

test("the reader knows the operators tikz-flora paints", () => {
  assert.deepEqual([...OPERATORS].sort(), ["Do", "J", "Q", "RG", "S", "W", "c", "cm", "cs", "f", "f*", "gs", "h", "j", "l", "m", "n", "q", "rg", "scn", "w"].sort());
});

test("anything wrong stops the reader with its name", () => {
  const bad: [string, RegExp, Partial<PdfScene>?][] = [
    ["0 0 m 1 1 l B", /unknown operator B/],
    ["q 0 0 m 1 1 l S", /unclosed q/],
    ["Q", /Q without q/],
    ["0 0 rg", /rg takes 3/],
    ["/bad gs", /unknown blend Overlay/],
    ["/nope gs", /no opacity state nope/],
    ["/Pattern cs /nope scn", /no pattern nope/],
    ["/DeviceRGB cs", /colour space DeviceRGB/],
    ["/im Do", /no image im/],
    ["/im Do", /holds 3 bytes/, { images: { im: { w: 1, h: 1, rgba: Buffer.from([1, 2, 3]).toString("base64") } } }],
    ["0 0 m 1 1 l", /left unpainted/],
    ["1 1 l f", /lineTo without a current point/],
    ["0 0 m 1 0 l 1 1 l h W f", /W before a fill/],
    ["1.2.3 0 m", /bad number/],
  ];
  for (const [content, msg, extra] of bad) assert.throws(() => fromPdfScene(scene(content, extra)), msg, content);
});
