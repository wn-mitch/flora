// A test harness that runs unchanged in Node, LuaTeX's texlua and LuaJIT,
// so the engine's tests check every target alike (tests/engine/run.ts).
import { exit, fmt, out } from "#platform";

type Case = { name: string; fn: () => void };
const cases: Case[] = [];

export function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

export function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function eq(got: number | string | boolean, want: number | string | boolean, what: string): void {
  if (got !== want) throw new Error(`${what}: got ${show(got)}, want ${show(want)}`);
}

// Equal lengths and equal numbers, place by place.
export function eqList(got: readonly number[], want: readonly number[], what: string): void {
  if (got.length !== want.length) throw new Error(`${what}: ${fmt(got.length, 0)} items, want ${fmt(want.length, 0)}`);
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) throw new Error(`${what}: item ${fmt(i, 0)} is ${show(got[i])}, want ${show(want[i])}`);
  }
}

// |got - want| <= tol.
export function near(got: number, want: number, tol: number, what: string): void {
  if (!(Math.abs(got - want) <= tol)) throw new Error(`${what}: got ${fmt(got, 12)}, want ${fmt(want, 12)} within ${fmt(tol, 12)}`);
}

// fn throws an error whose message contains `part`.
export function throws(fn: () => void, part: string, what: string): void {
  let message: string | undefined;
  try {
    fn();
  } catch (e) {
    // The Lua platforms raise strings, as Lua's error() does.
    message = e instanceof Error ? e.message : typeof e === "string" ? e : "something neither an Error nor a string was thrown";
  }
  if (message === undefined) throw new Error(`${what}: did not throw`);
  if (message.indexOf(part) < 0) throw new Error(`${what}: threw "${message}", not "${part}"`);
}

function show(v: number | string | boolean): string {
  if (typeof v === "number") return Math.abs(v) < 1e15 && v === v ? fmt(v, 6) : "a non-finite or huge number";
  return typeof v === "string" ? `"${v}"` : v ? "true" : "false";
}

// Runs every case, reports each, and exits non-zero on any failure.
export function run(target: string): void {
  let failed = 0;
  for (const c of cases) {
    try {
      c.fn();
      out(`ok   ${c.name}`);
    } catch (e) {
      failed++;
      out(`FAIL ${c.name}\n     ${e instanceof Error ? e.message : typeof e === "string" ? e : "something neither an Error nor a string was thrown"}`);
    }
  }
  out(failed > 0 ? `${target}: ${fmt(failed, 0)} of ${fmt(cases.length, 0)} failed` : `${target}: ${fmt(cases.length, 0)} passed`);
  exit(failed > 0 ? 1 : 0);
}
