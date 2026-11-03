// The declarations of lua/53/platform.lua and lua/jit/platform.lua, the
// Lua builds' "#platform": src/engine/platform.ts's
// (tests/engine-rules.test.ts checks they match).
export declare function add32(a: number, b: number): number;
export declare function mul32(a: number, b: number): number;
export declare function xor32(a: number, b: number): number;
export declare function and32(a: number, b: number): number;
export declare function or32(a: number, b: number): number;
export declare function shl32(a: number, n: number): number;
export declare function shr32(a: number, n: number): number;
export declare function mod(a: number, b: number): number;
export declare function fmt(x: number, digits: number): string;
export declare function sortedKeys(o: Readonly<Record<string, unknown>>): string[];
export declare function sortNumbers(xs: number[]): void;
export declare function utf8(s: string): number[];
export declare function hypot(x: number, y: number): number;
export declare function out(line: string): void;
export declare function exit(code: number): void;
