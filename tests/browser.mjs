// Bundles tests/render.browser.ts and runs it in headless Chrome with the
// machine's GPU, printing each case and exiting non-zero on any failure.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = join(root, "build", "browser-test.js");
await build({ entryPoints: [join(root, "tests", "render.browser.ts")], bundle: true, format: "esm", outfile: out, logLevel: "warning" });
const page = `<!doctype html><meta charset="utf-8"><title>flora renderer tests</title><script type="module" src="/test.js"></script>`;
const server = createServer(async (req, res) => {
  if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(page);
  if (req.url === "/test.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(await readFile(out));
  res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failed = 0;
try {
  const p = await browser.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  // The cases run as the page loads, so its load event waits for them.
  await p.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "commit" });
  await p.waitForFunction(() => window.done || null, null, { timeout: 300000 }).catch(() => {});
  const done = await p.evaluate(() => window.done);
  if (!done) throw new Error("the tests never finished: " + errors.join("; "));
  for (const r of done.results) {
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : "\n     " + r.msg}`);
    if (!r.ok) failed++;
  }
  for (const line of done.log) console.log("     " + line);
  if (errors.length) { console.log("page errors: " + errors.join("; ")); failed++; }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `${failed} failure(s)` : "renderer: ok");
process.exit(failed ? 1 : 0);
