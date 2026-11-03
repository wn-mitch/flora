// Title-page furniture for the title layout: a crest in the gap at the top
// centre where the two crowning plants meet, a flourish under the title
// block, a tailpiece under the page's last line and a piece in each foot
// corner. Each slot's kind is drawn by weight (ornaments.ts); a slot whose
// kinds all weigh 0, or whose place has no room, is left out. Boxes are
// page boxes, y up.
import { fmt } from "#platform";
import * as G from "./geom.ts";
import type { Box as LineBox, PageSpec } from "./layout.ts";
import { toNumber } from "./mix.ts";
import { draw, pick, type Box, type OrnamentKind, type SlotOptions } from "./ornaments.ts";
import type { Painter } from "./paint.ts";
import { Rng } from "./rng.ts";

const PAD = 10;

// What title furniture reads of a page: its seed and ornament weights.
export interface TitleSpec extends PageSpec {
  readonly seed?: string | number;
  readonly ornaments?: Readonly<Record<string, number>>;
}

// One piece of furniture: its slot, kind, box and slot extras.
export interface Piece {
  readonly slot: string;
  readonly kind: OrnamentKind;
  readonly box: Box;
  readonly o: SlotOptions;
}

// The kind for `slot` on this page, or undefined.
function choose(spec: TitleSpec, slot: string): OrnamentKind | undefined {
  return pick(new Rng(toNumber(spec.seed) ?? 1).fork("choose title " + slot), slot, spec.ornaments);
}

// The crest's side for a crown whose heroes have radius R, or 0 with no
// crest. The frames leave this much more of the top centre open.
export function crestSize(spec: TitleSpec, R: number): number {
  if (choose(spec, "crest") === undefined) return 0;
  return G.clamp(R * 1.2, 44, 84);
}

// The highest measured line wholly below height y, or undefined.
function nextBelow(lines: readonly LineBox[] | undefined, y: number): LineBox | undefined {
  let best: LineBox | undefined;
  for (const l of lines ?? []) if (l.y1 < y && (best === undefined || l.y1 > best.y1)) best = l;
  return best;
}

// The furniture for a title page with title block B (frames.ts), whose
// crown left a gap `crest` wide at the top centre. Returns the pieces and
// the boxes the plants must keep out of.
export function plan(spec: TitleSpec, B: LineBox, crest: number): [Piece[], Box[]] {
  const W = spec.width, H = spec.height;
  const t = spec.text;
  const cx = (B.x0 + B.x1) / 2;
  const out: Piece[] = [], keep: Box[] = [];
  const add = (slot: string, box: Box, reserve: boolean) => {
    const kind = choose(spec, slot);
    if (kind === undefined) return;
    out.push({ slot, kind, box, o: {} });
    if (reserve) keep.push(box);
  };
  if (crest > 0) add("crest", [W / 2 - crest / 2, H - PAD - crest, W / 2 + crest / 2, H - PAD], false);
  // The flourish hangs under the title block when the gap down to the next
  // line holds it with room either side.
  const below = nextBelow(spec.lines, B.y0);
  const fw = Math.min(280, (B.x1 - B.x0) * 1.15, t.x1 - t.x0);
  const fh = (fw * 46) / 280;
  const floor = below?.y1 ?? t.y0;
  if (B.y0 - floor >= fh + 2 * PAD) {
    const y1 = B.y0 - PAD * 0.6;
    add("flourish", [cx - fw / 2, y1 - fh, cx + fw / 2, y1], true);
  }
  // The tailpiece sits under the lowest line, inside the text block, when
  // any text follows the title.
  let last: LineBox | undefined;
  for (const l of spec.lines ?? []) if (last === undefined || l.y0 < last.y0) last = l;
  if (last !== undefined && last.y1 < B.y0) {
    const tw = Math.min(140, (t.x1 - t.x0) * 0.4);
    const th = (tw * 88) / 140;
    const y1 = last.y0 - PAD * 1.6;
    if (y1 - th >= t.y0) {
      const tx = (t.x0 + t.x1) / 2;
      add("tailpiece", [tx - tw / 2, y1 - th, tx + tw / 2, y1], true);
    }
  }
  // A piece in each foot corner, inside the side margins.
  const s = Math.min(72, t.x0 - 24, W - t.x1 - 24, t.y0 - 24);
  if (s >= 28) {
    const kind = choose(spec, "corner");
    if (kind !== undefined) {
      out.push({ slot: "corner", kind, box: [16, 16, 16 + s, 16 + s], o: { flip: [1, 1] } });
      out.push({ slot: "corner", kind, box: [W - 16 - s, 16, W - 16, 16 + s], o: { flip: [-1, 1] } });
    }
  }
  return [out, keep];
}

// The flank layout's foot piece: a crest-slot kind in the lowest gap of
// column `block` (frames.ts) that holds it, else in the foot band under the
// column. Undefined when no kind or no room.
export function foot(spec: TitleSpec, block: LineBox): Piece | undefined {
  const kind = choose(spec, "crest");
  if (kind === undefined) return undefined;
  const W = spec.width, t = spec.text;
  let s = G.clamp((block.x1 - block.x0) * 0.32, 44, 84);
  const ls = (spec.lines ?? []).filter((l) => l.x1 > block.x0 && l.x0 < block.x1 && l.y1 > t.y0 - 2);
  G.sortBy(ls, (l) => l.y0);
  let y0: number | undefined;
  // From the bottom up: the first gap between lines that holds the piece.
  for (let i = 0; i + 1 < ls.length; i++) {
    if (ls[i + 1].y0 - ls[i].y1 >= s + 2 * PAD) {
      y0 = ls[i].y1 + PAD;
      break;
    }
  }
  if (y0 === undefined) {
    const floor = 18;
    const top = (ls.length > 0 ? Math.min(ls[0].y0, t.y0) : t.y0) - PAD;
    if (top - floor < 28) return undefined;
    s = Math.min(s, top - floor);
    y0 = floor;
  }
  return { slot: "crest", kind, box: [W / 2 - s / 2, y0, W / 2 + s / 2, y0 + s], o: {} };
}

// Paint the planned furniture onto pt, in page coordinates.
export function paint(pt: Painter, spec: TitleSpec, pieces: readonly Piece[]): void {
  const rng = new Rng(toNumber(spec.seed) ?? 1);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    // The two corner pieces are one design mirrored, so they share a
    // stream.
    draw(p.kind, pt, rng.fork("title " + p.slot + (p.slot === "corner" ? "" : fmt(i + 1, 0))), p.box, p.o);
  }
}
