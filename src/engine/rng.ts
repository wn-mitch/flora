// Seeded pseudo-random streams (mulberry32). Every drawing decision draws
// from a stream, so a seed reproduces a picture exactly on every target.
// `fork` derives an independent child stream from a label, which keeps one
// element's randomness from shifting when another element changes.
import { add32, fmt, mod, mul32, or32, shr32, sortedKeys, utf8, xor32 } from "#platform";

const U32 = 4294967296;

// FNV-1a over the UTF-8 bytes of `s`, as a 32-bit integer.
export function hash(s: string): number {
  let h = 2166136261;
  for (const b of utf8(s)) h = mul32(xor32(h, b), 16777619);
  return h;
}

export class Rng {
  readonly seed: number;
  private s: number;

  // A stream from an integer seed (taken modulo 2^32) or a string's hash.
  constructor(seed: number | string, state?: number) {
    this.seed = typeof seed === "string" ? hash(seed) : mod(Math.floor(seed), U32);
    this.s = state ?? this.seed;
  }

  // Uniform in [0, 1).
  next(): number {
    this.s = add32(this.s, 0x6d2b79f5);
    let t = this.s;
    t = mul32(xor32(t, shr32(t, 15)), or32(t, 1));
    t = xor32(t, add32(t, mul32(xor32(t, shr32(t, 7)), or32(t, 61))));
    return xor32(t, shr32(t, 14)) / U32;
  }

  // Uniform in [a, b).
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  // Uniform integer in [a, b].
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  // Symmetric jitter in [-a, a).
  jit(a: number): number {
    return (this.next() * 2 - 1) * a;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  // A normal deviate (Box-Muller).
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  // A key of `weights` drawn in proportion to its weight, or undefined when
  // no weight is positive. Keys are taken in sorted order, so the draw does
  // not depend on how the table was built.
  weighted(weights: Readonly<Record<string, number>>): string | undefined {
    const keys: string[] = [];
    let total = 0;
    for (const k of sortedKeys(weights)) {
      if (weights[k] > 0) {
        keys.push(k);
        total += weights[k];
      }
    }
    if (total <= 0) return undefined;
    let x = this.next() * total;
    for (const k of keys) {
      x -= weights[k];
      if (x < 0) return k;
    }
    return keys[keys.length - 1];
  }

  // An independent copy at the current position: it yields exactly what this
  // stream would yield next.
  clone(): Rng {
    return new Rng(this.seed, this.s);
  }

  // A child stream whose seed depends only on this stream's seed and `label`.
  fork(label: string): Rng {
    return new Rng(hash(label + ":" + fmt(this.seed, 0)));
  }
}
