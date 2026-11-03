// What the engine needs from its host, for JavaScript. Engine code imports
// it as "#platform"; the Lua builds map that name to lua/53/platform.lua
// (LuaTeX) or lua/jit/platform.lua (LuaJIT), which give the same answers.
// tests/engine/platform.spec.ts runs on all three.
//
// Engine code must not use the operators these replace: JavaScript's
// bitwise operators work on signed 32-bit integers, Lua 5.3's on 64-bit
// ones, LuaJIT's through its bit library; `%` truncates in JavaScript but
// floors in Lua; and numbers become strings differently in each.
// tests/engine-rules.test.ts enforces this.

// 32-bit unsigned arithmetic. Arguments are integers in [0, 2^32); results
// are too.
export function add32(a: number, b: number): number {
  return (a + b) >>> 0;
}
export function mul32(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}
export function xor32(a: number, b: number): number {
  return (a ^ b) >>> 0;
}
export function and32(a: number, b: number): number {
  return (a & b) >>> 0;
}
export function or32(a: number, b: number): number {
  return (a | b) >>> 0;
}
// Shifts by n in [0, 31]; shr32 shifts in zeros.
export function shl32(a: number, n: number): number {
  return (a << n) >>> 0;
}
export function shr32(a: number, n: number): number {
  return a >>> n;
}

// a modulo b with the sign of b, as Lua's `%`: mod(-1, 3) is 2.
export function mod(a: number, b: number): number {
  const m = a % b;
  return m !== 0 && m < 0 !== b < 0 ? m + b : m;
}

// x with `digits` (0 to 12) decimals, as C's "%.*f": fmt(0.5, 2) is
// "0.50". A result that rounds to zero carries no minus sign. Halfway
// cases exact in binary (0.125 to 2 digits) may round differently from
// Lua, which rounds them to even. Throws on NaN and infinities.
export function fmt(x: number, digits: number): string {
  if (!Number.isFinite(x)) throw new Error(`fmt: ${x} is not finite`);
  if (!(digits >= 0 && digits <= 12 && Math.floor(digits) === digits)) throw new Error(`fmt: ${digits} digits`);
  if (Math.abs(x) >= 1e15) throw new Error(`fmt: ${x} is too large`);
  const s = x.toFixed(digits);
  return /^-[0.]+$/.test(s) ? s.slice(1) : s;
}

// The keys of `o`, sorted by their UTF-16 code units, which for ASCII keys
// is Lua's byte order. Iteration order over a Lua table is unspecified, so
// engine code reaches keys only through this.
export function sortedKeys(o: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(o).sort();
}

// Sorts `xs` ascending in place. Lua's table.sort is not stable, which for
// numbers changes nothing.
export function sortNumbers(xs: number[]): void {
  xs.sort((a, b) => a - b);
}

// The UTF-8 bytes of `s`.
export function utf8(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

// The square root of x^2 + y^2 (TypeScriptToLua lacks Math.hypot).
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

// A line to the host's output, and ending the program with `code`; for
// test runners.
export function out(line: string): void {
  console.log(line);
}
export function exit(code: number): void {
  process.exitCode = code;
}
