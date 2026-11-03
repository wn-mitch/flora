// Times the engine in headless Chrome on a sheet of leaves with their
// washes: growing them, converting the scene to a display list and drawing
// it with WebGL2. `node tests/leaf-bench.mjs [leaves] [runs] [scale]`;
// writes the drawing to build/leaf-bench.png.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const [leaves = "50", runs = "5", scale = "2"] = process.argv.slice(2);
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = join(root, "build", "leaf-bench.js");
await build({ entryPoints: [join(root, "tests", "leaf.bench.ts")], bundle: true, format: "esm", outfile: out, logLevel: "warning" });
const page = `<!doctype html><meta charset="utf-8"><title>flora leaf bench</title><style>body{margin:0}</style><script type="module" src="/bench.js"></script>`;
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/?") || req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(page);
  if (req.url === "/bench.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(await readFile(out));
  res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1440 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.address().port}/?leaves=${leaves}&runs=${runs}&scale=${scale}`, { waitUntil: "commit" });
  await p.waitForFunction(() => window.done || null, null, { timeout: 300000 }).catch(() => {});
  const done = await p.evaluate(() => window.done);
  if (!done) throw new Error("the bench never finished: " + errors.join("; "));
  await p.locator("canvas").screenshot({ path: join(root, "build", "leaf-bench.png") });
  const ms = (x) => `${x.toFixed(1)} ms`;
  console.log(`${done.leaves} leaves on ${done.size} at ${done.scale}x, median of ${done.runs} runs (first run in brackets):`);
  for (const k of ["engine", "convert", "prepare", "draw"]) console.log(`  ${k.padEnd(8)} ${ms(done[k]).padStart(10)}  (${ms(done.first[k])})`);
  console.log(`  total    ${ms(done.engine + done.convert + done.prepare + done.draw).padStart(10)}`);
  console.log(`  ${JSON.stringify(done.info)}`);
  console.log("  drawing: build/leaf-bench.png");
} finally {
  await browser.close();
  server.close();
}
