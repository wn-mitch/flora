// The flora engine: procedural flora in TypeScript that also compiles to Lua
// for LuaTeX and LuaJIT (tsconfig.lua53.json, tsconfig.jit.json). Engine
// code keeps to the rules tests/engine-rules.test.ts enforces, so every
// target draws alike.
export { add32, and32, fmt, hypot, mod, mul32, or32, shl32, shr32, sortedKeys, sortNumbers, utf8, xor32 } from "#platform";
export * as color from "./color.ts";
export * as geom from "./geom.ts";
export { hash, Rng } from "./rng.ts";
export { CORRIDOR, FREE, OUTSIDE, PLACED, Space, TEXT } from "./space.ts";
