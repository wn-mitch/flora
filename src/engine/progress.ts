// Progress through a page (compose.ts page's o.progress), as tikz-flora's
// compose.lua reports it: a span [lo, hi] of the whole page maps its own
// 0..1 into it. A value is sent once it passes the last one sent by at
// least STEP, and 1 always is, so a page sends a short, rising list ending
// in 1. Without a hook every call does nothing.
const STEP = 0.01;

export class Progress {
  private readonly fn: ((this: void, f: number) => void) | undefined;
  private readonly lo: number;
  private readonly hi: number;
  private readonly sent: { last: number };

  private constructor(fn: ((this: void, f: number) => void) | undefined, lo: number, hi: number, sent: { last: number }) {
    this.fn = fn;
    this.lo = lo;
    this.hi = hi;
    this.sent = sent;
  }

  static of(fn?: (this: void, f: number) => void): Progress {
    return new Progress(fn, 0, 1, { last: -1 });
  }

  // The part of this span from a to b (0..1 of it).
  part(a: number, b: number): Progress {
    const w = this.hi - this.lo;
    return new Progress(this.fn, this.lo + w * a, this.lo + w * b, this.sent);
  }

  at(f: number): void {
    if (this.fn === undefined) return;
    const v = this.lo + (this.hi - this.lo) * f;
    const s = this.sent;
    if (v > s.last && (v >= 1 || v >= s.last + STEP)) {
      s.last = v;
      this.fn(v);
    }
  }
}

// A plant's share of its progress: the grow to these points, then the
// painting, item by item, each item one unit and a bloom BLOOM units; the
// batches painted at once (stems, sprays, leaflets, the hero) count as the
// units given.
export const GROWN = { laid: 0.02, nodes: 0.06, holes: 0.16, details: 0.25 } as const;
export const BLOOM = 3;
export const BATCH = { stems: 4, sprays: 8, leaflets: 3, hero: 4, finish: 2 } as const;
// A title page's share of its progress taken by its title furniture.
export const TITLE_SHARE = 0.08;
