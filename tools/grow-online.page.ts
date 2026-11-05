// Runs in the browser (tools/grow-online.mjs): a garden grown online
// (src/grow) into a region as you watch. The region is a margin, or a
// random walk of joined pentominoes; the main stem starts at its top,
// heading down. ?seed, ?shape (margin | pentominoes), ?layers (fixed |
// fixed gaps | depth | depth gaps), ?speed (ticks per frame) and ?play=0 set it up; the controls change them. window.grow
// exposes the garden, and step(n) / show() for a runner taking pictures.
import { Garden, Surface, type Rect } from "../src/grow/index.ts";
import { Rng } from "../src/engine/rng.ts";

const q = new URLSearchParams(location.search);
const PAPER: [number, number, number] = [249 / 255, 248 / 255, 244 / 255];
const TILE = 600;

// Pentominoes, as cells.
const PENTOMINOES: [number, number][][] = [
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]], [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]], [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]], [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
];

interface Region { readonly width: number; readonly height: number; readonly open: Rect[]; readonly root: [number, number] }

// A walk of joined pentominoes down a strip `cols` cells wide, each placed
// touching those before it.
function pentominoes(seed: string): Region {
  const rng = new Rng("pentominoes " + seed);
  const C = 40, cols = 8, n = 34;
  const cells = new Set<string>();
  const key = (i: number, j: number) => `${i},${j}`;
  const put = (shape: [number, number][], i: number, j: number) => { for (const [a, b] of shape) cells.add(key(i + a, j + b)); };
  put(PENTOMINOES[0].map(([a, b]) => [b, a]), 3, 0);
  for (let k = 0; k < n; k++) {
    for (let tries = 0; tries < 60; tries++) {
      let shape = PENTOMINOES[rng.int(1, PENTOMINOES.length) - 1];
      for (let r = rng.int(0, 3); r > 0; r--) shape = shape.map(([a, b]) => [-b, a]);
      const all = [...cells].map((s) => s.split(",").map(Number));
      const [ai, aj] = all[rng.int(1, all.length) - 1];
      const [si, sj] = shape[rng.int(1, 5) - 1];
      // Downward walks are likelier, so the region runs down the page.
      const di = rng.int(-1, 1), dj = rng.chance(0.6) ? 1 : rng.int(-1, 1);
      const oi = ai + di - si, oj = aj + dj - sj;
      const placed = shape.map(([a, b]) => [oi + a, oj + b]);
      if (placed.some(([i, j]) => i < 0 || i >= cols || j < 0 || cells.has(key(i, j)))) continue;
      if (!placed.some(([i, j]) => cells.has(key(i + 1, j)) || cells.has(key(i - 1, j)) || cells.has(key(i, j + 1)) || cells.has(key(i, j - 1)))) continue;
      put(shape, oi, oj);
      break;
    }
  }
  const all = [...cells].map((s) => s.split(",").map(Number));
  const rows = Math.max(...all.map(([, j]) => j)) + 1, height = rows * C, width = cols * C;
  const open: Rect[] = all.map(([i, j]) => [i * C, height - (j + 1) * C, (i + 1) * C, height - j * C]);
  const top = all.filter(([, j]) => j === 0).sort((p, r) => p[0] - r[0]);
  const [ti] = top[Math.floor(top.length / 2)];
  return { width, height, open, root: [(ti + 0.5) * C, height - 4] };
}

function margin(): Region {
  const width = 300, height = 3000;
  return { width, height, open: [[0, 0, 270, height]], root: [210, height - 4] };
}

const stage = document.getElementById("stage")!;
const stats = document.getElementById("stats")!;
const seedIn = document.getElementById("seed") as HTMLInputElement;
const shapeIn = document.getElementById("shape") as HTMLSelectElement;
const layersIn = document.getElementById("layers") as HTMLSelectElement;
const speedIn = document.getElementById("speed") as HTMLInputElement;
const playIn = document.getElementById("play") as HTMLButtonElement;
seedIn.value = q.get("seed") ?? "7";
shapeIn.value = q.get("shape") ?? "pentominoes";
layersIn.value = q.get("layers") ?? "fixed";
speedIn.value = q.get("speed") ?? "6";
let playing = q.get("play") !== "0";

let garden: Garden, surface: Surface;
const dpr = Math.min(2, devicePixelRatio || 1);
let frameMs: number[] = [];

function start(): void {
  const region = shapeIn.value === "margin" ? margin() : pentominoes(seedIn.value);
  stage.replaceChildren();
  stage.style.width = `${region.width}px`;
  stage.style.height = `${region.height}px`;
  // The region, faintly, so its shape shows.
  for (const r of region.open) {
    const d = document.createElement("div");
    Object.assign(d.style, { position: "absolute", left: `${r[0]}px`, top: `${region.height - r[3]}px`, width: `${r[2] - r[0]}px`, height: `${r[3] - r[1]}px`, outline: "1px solid rgba(0,0,0,0.05)" });
    stage.append(d);
  }
  const tiles: { y: number; h: number }[] = [];
  for (let y = 0; y < region.height; y += TILE) tiles.push({ y, h: Math.min(TILE, region.height - y) });
  const t0 = performance.now();
  garden = new Garden({ width: region.width, height: region.height, open: region.open, root: region.root, heading: -Math.PI / 2, seed: seedIn.value, depth: layersIn.value.startsWith("depth"), gaps: layersIn.value.endsWith("gaps") });
  surface = new Surface({
    width: region.width, height: region.height, scale: dpr, tiles, paper: PAPER,
    canvas: (i, w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      Object.assign(c.style, { position: "absolute", left: "0", top: `${tiles[i].y}px`, width: `${region.width}px`, height: `${tiles[i].h}px`, mixBlendMode: "multiply" });
      stage.append(c);
      return c;
    },
  });
  frameMs = [];
  stats.textContent = `set up in ${(performance.now() - t0).toFixed(1)} ms`;
}

function step(n: number): void {
  garden.step(n);
  surface.lay(garden.takeFinished());
  surface.merge(garden.settledTo);
}

function show(): void {
  surface.show(garden.live(), garden.tick);
}

function loop(): void {
  if (playing && !garden.done) {
    const a = performance.now();
    step(Number(speedIn.value));
    show();
    frameMs.push(performance.now() - a);
    if (frameMs.length > 120) frameMs.shift();
  }
  const sorted = [...frameMs].sort((x, y) => x - y);
  const med = sorted[sorted.length >> 1] ?? 0, p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  stats.textContent = `tick ${garden.tick} · live ${garden.live().length} · frame ${med.toFixed(1)} ms (p90 ${p90.toFixed(1)}) · ${garden.done ? "done" : playing ? "growing" : "paused"}${garden.placedHero ? " · hero" : ""} · ${surface.held} layers held`;
  requestAnimationFrame(loop);
}

playIn.onclick = () => { playing = !playing; playIn.textContent = playing ? "pause" : "play"; };
playIn.textContent = playing ? "pause" : "play";
(document.getElementById("again") as HTMLButtonElement).onclick = start;
seedIn.onchange = start;
shapeIn.onchange = start;
layersIn.onchange = start;
start();
requestAnimationFrame(loop);

declare global { interface Window { grow: unknown } }
window.grow = { get garden() { return garden; }, step, show, start };
