// The package as npm would publish it: packed, installed into a fresh
// project, imported by its name from plain Node, and typechecked as a
// consumer would (nodenext and bundler resolution). Catches exports that
// point at nothing, compiled files still importing "#platform" or ".ts"
// paths, and files left out of (or let into) the tarball.
//
//   node tests/package.mjs      (after npm run build; prepublishOnly runs it)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const NAME = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;
const work = mkdtempSync(join(tmpdir(), "flora-package-"));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error("FAIL: " + msg); } };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  // Packed without running prepare again: the build is checked as it is.
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], ROOT));
  const files = packed.files.map((f) => f.path);
  for (const f of ["dist/index.js", "dist/index.d.ts", "dist/engine/index.js", "dist/engine/index.d.ts", "dist/engine/platform.js", "README.md", "LICENSE", "package.json"]) {
    check(files.includes(f), `the tarball lacks ${f}`);
  }
  check(!files.some((f) => /^(tests|tools|lua|build|backlog|node_modules)\//.test(f)), `the tarball carries repo files: ${files.filter((f) => !/^(dist|src)\//.test(f)).join(", ")}`);

  const app = join(work, "app");
  run("mkdir", ["-p", app]);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "app", private: true, type: "module" }));
  run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", join(work, packed.filename)], app);

  // The home page's example, in plain Node (no DOM: the display list, not
  // the canvas), and a page's progress.
  writeFileSync(join(app, "use.mjs"), `
    import { compose, Painter } from "${NAME}/engine";
    import { toDisplayList } from "${NAME}";
    const text = { x0: 130, y0: 24, x1: 160, y1: 876 };
    const spec = { width: 160, height: 900, seed: 7, text, lines: [text] };
    const pt = new Painter({ width: 160, height: 900 });
    compose.plant(spec, pt);
    const list = toDisplayList(pt.scene());
    const sent = [];
    compose.page({ width: 595, height: 842, seed: 2, text: { x0: 162, y0: 120, x1: 436, y1: 720 }, lines: [] }, { progress: (f) => sent.push(f) });
    console.log(JSON.stringify({ items: list.items.length, last: sent.at(-1), sent: sent.length }));
  `);
  let used = {};
  try {
    used = JSON.parse(run("node", ["use.mjs"], app));
  } catch (e) {
    check(false, `the example does not run from the installed package:\n${String(e.stderr ?? e).split("\n").slice(0, 6).join("\n")}`);
  }
  check(used.items > 100, `the example paints ${used.items} items`);
  check(used.last === 1 && used.sent > 10, `a page's progress ends at ${used.last} after ${used.sent} values`);

  // The same example typechecked by a consumer, under both resolutions.
  writeFileSync(join(app, "use.ts"), `
    import { compose, Painter } from "${NAME}/engine";
    import { toDisplayList, WebGLRenderer } from "${NAME}";
    const text = { x0: 130, y0: 24, x1: 160, y1: 876 };
    const pt = new Painter({ width: 160, height: 900 });
    compose.plant({ width: 160, height: 900, seed: 7, text, lines: [text] }, pt);
    declare const canvas: HTMLCanvasElement;
    new WebGLRenderer(canvas).draw(toDisplayList(pt.scene()), { scale: 1 });
    // @ts-expect-error: a spec needs its size.
    compose.plant({ seed: 7 }, pt);
  `);
  const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
  for (const [module, resolution] of [["nodenext", "nodenext"], ["esnext", "bundler"]]) {
    try {
      run("node", [tsc, "--noEmit", "--strict", "--skipLibCheck", "false", "--target", "es2022", "--lib", "es2022,dom", "--module", module, "--moduleResolution", resolution, "use.ts"], app);
    } catch (e) {
      check(false, `a consumer's typecheck (${resolution}) fails:\n${e.stdout}${e.stderr}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log(`package: ok (${NAME})`);
