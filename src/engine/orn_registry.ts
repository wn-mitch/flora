// The ornament registry. Every ornament kind registers under a unique
// name, for one slot: a place on the page that can take any kind
// registered for it. A page picks one kind per slot by weight, from its
// own random stream, so the choice never moves anything else. Settings
// change the weights with ornaments={moon=2, sun=0}. ornaments.ts
// registers every kind.
import type { Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";
import { ORNAMENTS } from "./tune.ts";

// A box [x0, y0, x1, y1] in page coordinates, y up.
export type Box = readonly [number, number, number, number];

// Slot extras: the pendant's cord length, a corner's mirroring.
export interface SlotOptions {
  readonly cord?: number;
  readonly flip?: readonly [number, number];
}

export interface OrnamentKind {
  readonly name: string;   // the key in ornaments={...}
  readonly slot: string;   // one of SLOTS
  readonly label: string;  // a short name for the mixer and the gallery
  readonly reach: number;  // how far past its box it may paint, share of the box's larger side
  // Paint inside `box`.
  readonly draw: (this: void, pt: Painter, rng: Rng, box: Box, o: SlotOptions) => void;
  // For the gilt slot: the sparkle it paints, and whether it is one of the
  // reference's own (which keep their original random stream).
  readonly sparkle?: string;
  readonly classic?: boolean;
}

export interface Slot {
  readonly label: string;
  readonly desc: string;
  readonly aspect: number; // the box's usual width / height
}

export const SLOTS: Readonly<Record<string, Slot>> = {
  cartouche: { label: "Cartouche", desc: "An inset panel in the outer margin.", aspect: 0.74 },
  header: { label: "Header", desc: "The gilt mark where the running-head rule starts.", aspect: 1 },
  pendant: { label: "Pendant", desc: "A gilt pendant hanging in the foot's corner; o.cord is its cord.", aspect: 0.7 },
  crest: { label: "Crest", desc: "A centrepiece where the title crown meets.", aspect: 1 },
  flourish: { label: "Flourish", desc: "A swash or rule below the title.", aspect: 6 },
  tailpiece: { label: "Tailpiece", desc: "A closing ornament below the title page's text.", aspect: 1.6 },
  corner: { label: "Corner", desc: "A corner piece; drawn into the lower-left corner of its box (o.flip mirrors it).", aspect: 1 },
  gilt: { label: "Gilt", desc: "The larger gilt scattered in the foliage's gaps, picked for each gap.", aspect: 1 },
};
export const SLOT_ORDER = ["cartouche", "header", "pendant", "crest", "flourish", "tailpiece", "corner", "gilt"];

const kinds: Record<string, OrnamentKind> = {};
const order: string[] = [];

export interface KindSpec {
  readonly name: string;
  readonly slot: string;
  readonly label?: string;
  readonly reach?: number;
  readonly draw: (this: void, pt: Painter, rng: Rng, box: Box, o: SlotOptions) => void;
  readonly sparkle?: string;
  readonly classic?: boolean;
}

export function register(k: KindSpec): OrnamentKind {
  if (SLOTS[k.slot] === undefined) throw new Error("ornament " + k.name + ": unknown slot " + k.slot);
  if (kinds[k.name] !== undefined) throw new Error("ornament " + k.name + " is registered twice");
  const kind: OrnamentKind = { ...k, label: k.label ?? k.name, reach: k.reach ?? 0.05 };
  kinds[k.name] = kind;
  order.push(k.name);
  return kind;
}

export function kind(name: string): OrnamentKind | undefined {
  return kinds[name];
}

// The kinds registered for `slot`, in registration order.
export function of(slot: string): OrnamentKind[] {
  const out: OrnamentKind[] = [];
  for (const n of order) if (kinds[n].slot === slot) out.push(kinds[n]);
  return out;
}

// The weight of kind `name` under settings `weights`, else ORNAMENTS,
// else 1.
export function weight(weights: Readonly<Record<string, number>> | undefined, name: string): number {
  return weights?.[name] ?? ORNAMENTS[name] ?? 1;
}

// One kind for `slot`, drawn by weight from `rng` (give it a stream of its
// own); undefined when every kind of the slot weighs 0.
export function pick(rng: Rng, slot: string, weights?: Readonly<Record<string, number>>): OrnamentKind | undefined {
  const t: Record<string, number> = {};
  for (const k of of(slot)) t[k.name] = weight(weights, k.name);
  const name = rng.weighted(t);
  return name === undefined ? undefined : kinds[name];
}
