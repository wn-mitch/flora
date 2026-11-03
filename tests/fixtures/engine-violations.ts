// Every construct tests/engine-rules.test.ts must refuse in engine code,
// one per line, each tagged with the rule it breaks. Not engine code
// itself: the rules test reads it to prove it can fail.
const n = 3, s = "a", o: Record<string, number> = { a: 1 };
const maybe = (): number | undefined => (n > 2 ? 1 : undefined);
const holes: (number | undefined)[] = [];
let m = 5;
export const cases = [
  n & 1, // bitwise
  n | 1, // bitwise
  n ^ 1, // bitwise
  n << 1, // bitwise
  n >> 1, // bitwise
  n >>> 1, // bitwise
  ~n, // bitwise
  (m <<= 1), // bitwise
  n % 2, // mod
  (m %= 2), // mod
  /a+/.test(s), // regex
  new RegExp("a"), // regex
  `${n}`, // number-to-string
  s + n, // number-to-string
  n + s, // number-to-string
  String(n), // number-to-string
  [n, 2].join(","), // number-to-string
  n.toString(), // number-to-string
  n.toFixed(2), // number-to-string
  Object.keys(o), // order
  Object.entries(o), // order
  [3, 1, 2].sort(), // order
  new Float64Array(2), // typed-array
  Math.random(), // host
  Date.now(), // host
];
for (const k in o) cases.push(o[k]); // order
holes.push(maybe()); // hole
export const gap = [1, maybe()]; // hole
const base = { a: 1, b: 2 as number | undefined };
export const cleared = { ...base, b: undefined }; // spread-nil
export const maybeCleared = { ...base, b: maybe() }; // spread-nil
const b = maybe();
export const shorthand = { ...base, b }; // spread-nil
export const before = { c: maybe(), ...base };
