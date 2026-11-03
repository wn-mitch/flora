// The original ornaments, as registry kinds: the night-sky star
// cartouche, the compass at the running head and the knot pendant
// (ornament.ts).
import * as O from "./ornament.ts";
import { register } from "./orn_registry.ts";

export function registerClassic(): void {
  register({
    name: "night", slot: "cartouche", label: "Night sky",
    draw: (pt, rng, b) => O.panel(pt, rng, b[0], b[1], b[2] - b[0], b[3] - b[1]),
  });
  // The compass's crosshair reaches 1.5 times its radius.
  register({
    name: "compass", slot: "header", label: "Compass star", reach: 0.26,
    draw: (pt, _rng, b) => O.compass(pt, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, (b[2] - b[0]) / 2, { hair: 1.5 }),
  });
  // The cord runs up o.cord pt from the pendant's top.
  register({
    name: "knot", slot: "pendant", label: "Knot pendant",
    draw: (pt, rng, b, o) => { O.pendant(pt, rng, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b[2] - b[0], b[3] - b[1], o.cord ?? 0); },
  });
}
