// The platform's answers on every target: the edges of 32-bit arithmetic
// where JavaScript, Lua 5.3 and LuaJIT disagree natively, and formatting.
import { add32, and32, fmt, hypot, mod, mul32, or32, shl32, shr32, xor32 } from "#platform";
import { eq, near, test, throws } from "./harness.ts";

const TOP = 4294967295; // 2^32 - 1

test("32-bit sums wrap", () => {
  eq(add32(TOP, 1), 0, "2^32 - 1 + 1");
  eq(add32(TOP, TOP), 4294967294, "(2^32 - 1) * 2");
  eq(add32(0x6d2b79f5, 0xdeadbeef), 0x4bd938e4, "the RNG's increment");
});

test("32-bit products keep the low 32 bits exactly", () => {
  eq(mul32(TOP, TOP), 1, "(2^32 - 1)^2");
  eq(mul32(0x80000000, 2), 0, "2^31 * 2");
  eq(mul32(2166136261, 16777619), 0x050c5d1f, "FNV's offset times its prime");
  // Large enough that a double product loses its low bits.
  eq(mul32(0xdeadbeef, 0xcafebabe), 0x88cf5b62, "0xdeadbeef * 0xcafebabe");
});

test("bitwise results are unsigned", () => {
  eq(xor32(0xdeadbeef, TOP), 0x21524110, "xor with all ones");
  eq(xor32(0x80000000, 0), 0x80000000, "the top bit alone");
  eq(and32(TOP, 0x80000001), 0x80000001, "and");
  eq(or32(0x80000000, 1), 0x80000001, "or");
  eq(shl32(0xffffffff, 31), 0x80000000, "shl drops the high bits");
  eq(shl32(1, 31), 0x80000000, "1 << 31 is unsigned");
  eq(shr32(0x80000000, 31), 1, "shr shifts in zeros");
  eq(shr32(TOP, 0), TOP, "shr by 0");
});

test("mod takes the sign of the divisor, as Lua's %", () => {
  eq(mod(7, 3), 1, "7 mod 3");
  eq(mod(-7, 3), 2, "-7 mod 3");
  eq(mod(7, -3), -2, "7 mod -3");
  eq(mod(-6, 3), 0, "-6 mod 3");
  near(mod(-0.5, 2 * Math.PI), 2 * Math.PI - 0.5, 1e-15, "an angle brought into [0, 2 pi)");
  near(mod(5.5, 2), 1.5, 0, "5.5 mod 2");
});

test("fmt writes fixed decimals", () => {
  eq(fmt(1.5, 2), "1.50", "1.5 to 2 places");
  eq(fmt(2, 0), "2", "an integer");
  eq(fmt(-3.14159, 3), "-3.142", "negative");
  eq(fmt(0.1 + 0.2, 4), "0.3000", "0.1 + 0.2");
  eq(fmt(123456.789, 1), "123456.8", "rounds up");
  eq(fmt(1e14, 0), "100000000000000", "1e14, not 1e+14");
});

test("fmt never writes negative zero", () => {
  eq(fmt(-0, 2), "0.00", "-0");
  eq(fmt(-0.00001, 4), "0.0000", "a negative that rounds to zero");
  eq(fmt(-0.4, 0), "0", "-0.4 to 0 places");
});

test("fmt refuses what it cannot write alike everywhere", () => {
  throws(() => fmt(0 / 0, 2), "not finite", "NaN");
  throws(() => fmt(1 / 0, 2), "not finite", "infinity");
  throws(() => fmt(1e15, 0), "too large", "1e15");
  throws(() => fmt(1, 13), "digits", "13 digits");
  throws(() => fmt(1, 1.5), "digits", "1.5 digits");
});

test("hypot", () => {
  eq(hypot(3, 4), 5, "3, 4");
  eq(hypot(-5, 12), 13, "-5, 12");
});
