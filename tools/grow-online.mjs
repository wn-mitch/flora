// A garden grown online (src/grow, tools/grow-online.page.ts), served for
// a look in your own browser:
//
//   node tools/grow-online.mjs [--port 5180]
//
// or, with --shots, grown headless and photographed every `every` ticks
// into build/grow-online/ (with the region seed and shape as given):
//
//   node tools/grow-online.mjs --shots 8 --every 150 [--seed 7] [--shape margin]
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: o } = parseArgs({
  options: {
    port: { type: "string", default: "5180" }, shots: { type: "string" }, every: { type: "string", default: "150" },
    seed: { type: "string", default: "7" }, shape: { type: "string", default: "pentominoes" }, layers: { type: "string", default: "fixed" },
  },
});
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const js = join(root, "build", "grow-online.js");
await build({ entryPoints: [join(root, "tools", "grow-online.page.ts")], bundle: true, format: "esm", outfile: js, logLevel: "warning" });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>flora online</title>
<style>body{margin:0;background:#f9f8f4;font:13px ui-sans-serif,system-ui;color:#333}#bar{position:sticky;top:0;z-index:2;background:#f9f8f4e8;padding:8px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #0001}#stage{position:relative;margin:16px}input{width:5em}</style>
<div id="bar">seed <input id="seed"> shape <select id="shape"><option>pentominoes</option><option>margin</option></select>
layers <select id="layers"><option>fixed</option><option>fixed gaps</option><option>depth</option><option>depth gaps</option></select>
ticks/frame <input id="speed" type="number" min="1" max="200"> <button id="play"></button> <button id="again">regrow</button> <span id="stats"></span></div>
<div id="stage"></div><script type="module" src="/grow.js"></script>`;
const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/") return res.writeHead(200, { "content-type": "text/html" }).end(html);
  if (path === "/grow.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(await readFile(js));
  res.writeHead(404).end();
});
await new Promise((ok) => server.listen(Number(o.port), "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;

if (o.shots === undefined) {
  console.log(`grow-online: ${url}`);
} else {
  const { chromium } = await import("playwright-core");
  const dir = join(root, "build", "grow-online");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
  try {
    const p = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${url}?${new URLSearchParams({ seed: o.seed, shape: o.shape, layers: o.layers, play: "0" })}`);
    await p.waitForFunction(() => window.grow, null, { timeout: 30000 });
    for (let i = 1; i <= Number(o.shots); i++) {
      const ms = await p.evaluate((n) => { const a = performance.now(); window.grow.step(n); window.grow.show(); return performance.now() - a; }, Number(o.every));
      const info = await p.evaluate(() => ({ tick: window.grow.garden.tick, done: window.grow.garden.done, live: window.grow.garden.live().length, reach: window.grow.garden.reach }));
      await p.locator("#stage").screenshot({ path: join(dir, `shot-${String(i).padStart(2, "0")}.png`) });
      console.log(`shot ${i}: tick ${info.tick} live ${info.live} reach ${Math.round(info.reach)} ${info.done ? "done" : ""} (${ms.toFixed(0)} ms for ${o.every} ticks)`);
    }
    if (errors.length) console.log("errors:", errors.join("\n"));
  } finally {
    await browser.close();
    server.close();
  }
}
