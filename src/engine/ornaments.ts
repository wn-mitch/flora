// Every ornament kind, registered in a fixed order (the gallery lists them
// so), and drawing a kind with its gold gilt. To add a kind, register it
// from a module's register function and call that here.
import { GILDER } from "./orn_gild.ts";
import { registerCelestial } from "./orn_celestial.ts";
import { registerClassic } from "./orn_classic.ts";
import { registerGilt } from "./orn_gilt.ts";
import { registerPieces } from "./orn_pieces.ts";
import { registerRoundel } from "./orn_roundel.ts";
import { registerScroll } from "./orn_scroll.ts";
import { kind as byName, type Box, type OrnamentKind, type SlotOptions } from "./orn_registry.ts";
import type { Painter } from "./paint.ts";
import type { Rng } from "./rng.ts";

export { kind, of, pick, SLOT_ORDER, SLOTS, weight, type Box, type OrnamentKind, type SlotOptions } from "./orn_registry.ts";

let ready = false;

// Register every kind, once.
export function registerAll(): void {
  if (ready) return;
  ready = true;
  registerClassic();
  registerCelestial();
  registerScroll();
  registerRoundel();
  registerPieces();
  registerGilt();
}

registerAll();

// Draw kind `k` (or the kind named k) into `box` with slot extras `o`. Its
// gold and copper are painted as gilt.
export function draw(k: OrnamentKind | string, pt: Painter, rng: Rng, box: Box, o: SlotOptions = {}): void {
  const kind = typeof k === "string" ? byName(k) : k;
  if (kind === undefined) throw new Error("no ornament " + (typeof k === "string" ? k : k.name));
  const was = pt.gild;
  pt.gild = GILDER;
  kind.draw(pt, rng, box, o);
  pt.gild = was;
}
