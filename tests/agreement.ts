// The engine gives the same answers in Node, texlua (Lua 5.3) and LuaJIT:
// tests/engine/dump.ts, run on each (the Lua bundles from just build-lua),
// must print the same lines, number for number. Numbers carry 12 decimals;
// transcendental functions may differ in their last bits between the
// targets' maths libraries, so numbers may differ by 1e-9, relative past 1.
//
//   node tests/agreement.ts         (after just build-lua)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TINY = join(process.env.HOME ?? "", "Library/TinyTeX/bin/universal-darwin/texlua");
const TEXLUA = process.env.TEXLUA ?? (existsSync(TINY) ? TINY : "texlua");
const LUAJIT = process.env.LUAJIT ?? "luajit";
const TOL = 1e-9;

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }).trimEnd().split("\n");
const node = run(process.execPath, ["tests/engine/dump.ts"]);
const targets: [string, string[]][] = [
  ["texlua", run(TEXLUA, ["build/lua53/dump.lua"])],
  ["luajit", run(LUAJIT, ["build/jit/dump.lua"])],
];

let failed = 0;
if (node.length < 20) {
  console.log(`FAIL node printed only ${node.length} lines`);
  failed++;
}
for (const [name, lines] of targets) {
  let worst = 0, count = 0;
  if (lines.length !== node.length) {
    console.log(`FAIL ${name} printed ${lines.length} lines, node ${node.length}`);
    failed++;
    continue;
  }
  for (let i = 0; i < node.length; i++) {
    const a = node[i].split(" "), b = lines[i].split(" ");
    const label = a[0] + " " + (a[1] ?? "");
    if (a.length !== b.length) {
      console.log(`FAIL ${name} line ${i + 1} (${label}): ${b.length} fields, node ${a.length}`);
      failed++;
      continue;
    }
    for (let k = 0; k < a.length; k++) {
      if (a[k] === b[k]) continue;
      const x = Number(a[k]), y = Number(b[k]);
      const gap = Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / Math.max(1, Math.abs(x), Math.abs(y)) : Infinity;
      if (gap > TOL) {
        console.log(`FAIL ${name} line ${i + 1} (${label}) field ${k}: ${b[k]}, node ${a[k]}`);
        failed++;
        break;
      }
      worst = Math.max(worst, gap);
      count++;
    }
  }
  console.log(`  ${name}: ${lines.length} lines; ${count} numbers differ in the last places, by at most ${worst.toExponential(1)}`);
}
console.log(failed ? `agreement: ${failed} differences` : "agreement: node, texlua and luajit agree");
process.exit(failed ? 1 : 0);
