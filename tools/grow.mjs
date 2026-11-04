// "Watch it grow": a page as its plants are laid down stroke by stroke
// (src/timeline.ts), drawn in headless Chrome and written as a video.
//
//   node tools/grow.mjs [--seed 3] [--layout L] [--spec page.json]
//     [--text text.png] [--fps 24] [--secs 10] [--scale 1.5]
//     [--out build/grow.mp4] [--gif build/grow.gif]
//
// The page is a body page of `seed` (in `layout`), or the FloraSpec in
// --spec; it is set over --text, a render of the page's text the page's
// own shape (which then sets the scale), or lorem ipsum. The front grows at
// an even pace over `secs`; the finished page then holds for a second and
// a half. Frames go to build/grow/f0000.png...; ffmpeg writes the video,
// and with --gif a GIF too. GROW_FRAMES=k1,k2,... writes only the frames
// at those shares of the growth (0-1), as build/grow/at-k.png, for a look.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values: o } = parseArgs({
  options: {
    seed: { type: "string", default: "3" }, layout: { type: "string" }, spec: { type: "string" }, text: { type: "string" },
    fps: { type: "string", default: "24" }, secs: { type: "string", default: "10" }, scale: { type: "string", default: "1.5" },
    out: { type: "string", default: "build/grow.mp4" }, gif: { type: "string" },
  },
});
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const js = join(root, "build", "grow.js");
const dir = join(root, "build", "grow");
await build({ entryPoints: [join(root, "tools", "grow.page.ts")], bundle: true, format: "esm", outfile: js, logLevel: "warning" });
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><title>flora grow</title><style>body{margin:0}</style><script type="module" src="/grow.js"></script>`;
const files = { "/grow.js": [js, "text/javascript"], "/spec.json": [o.spec, "application/json"], "/text.png": [o.text, "image/png"] };
const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/") return res.writeHead(200, { "content-type": "text/html" }).end(html);
  const f = files[path];
  if (f?.[0]) return res.writeHead(200, { "content-type": f[1] }).end(await readFile(resolve(f[0])));
  res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
try {
  const p = await browser.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const query = new URLSearchParams({ seed: o.seed, scale: o.scale, ...(o.layout ? { layout: o.layout } : {}) });
  await p.goto(`http://127.0.0.1:${server.address().port}/?${query}`, { waitUntil: "commit" });
  await p.waitForFunction(() => window.ready || null, null, { timeout: 120000 }).catch(() => {});
  const ready = await p.evaluate(() => window.ready);
  if (!ready) throw new Error("grow: the page never grew: " + errors.join("; "));
  const save = async (u, file) => {
    const url = await p.evaluate((u) => window.frame(u), u);
    await writeFile(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  };
  const only = process.env.GROW_FRAMES;
  if (only) {
    for (const k of only.split(",").map(Number)) await save(k * ready.end, join(dir, `at-${k.toFixed(2)}.png`));
    console.log(`grow: ${dir}/at-*.png (growth ${ready.end.toFixed(0)} pt)`);
  } else {
    const fps = Number(o.fps), n = Math.round(fps * Number(o.secs)), hold = Math.round(fps * 1.5);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await save((ready.end * i) / (n - 1), join(dir, `f${String(i).padStart(4, "0")}.png`));
    const last = join(dir, `f${String(n - 1).padStart(4, "0")}.png`);
    for (let k = 0; k < hold; k++) await copyFile(last, join(dir, `f${String(n + k).padStart(4, "0")}.png`));
    const ms = (performance.now() - t0) / n;
    const t = await p.evaluate((end) => [0.25, 0.5, 0.75].map((k) => window.time(end * k)), ready.end);
    const ffmpeg = (args) => {
      const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(fps), "-i", join(dir, "f%04d.png"), ...args], { stdio: "inherit" });
      if (r.status !== 0) throw new Error("grow: ffmpeg failed");
    };
    ffmpeg(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", resolve(o.out)]);
    if (o.gif) ffmpeg(["-vf", "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer", resolve(o.gif)]);
    console.log(`grow: ${o.out}${o.gif ? ` and ${o.gif}` : ""} (${n + hold} frames, ${ms.toFixed(0)} ms a frame, growth ${ready.end.toFixed(0)} pt)`);
    for (const [k, x] of [0.25, 0.5, 0.75].map((k, i) => [k, t[i]])) console.log(`  at ${k}: draw ${x.draw.toFixed(1)} ms in ${x.calls} calls`);
  }
} finally {
  await browser.close();
  server.close();
}
