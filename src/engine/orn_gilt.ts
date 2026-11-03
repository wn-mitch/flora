// The larger gilt scattered in the gaps the foliage leaves (fill.ts): the
// reference's dotted crosses, rosettes and lozenges, and a five-pointed
// star, a crescent and a trefoil. Each kind names the sparkle it paints
// (ornament.ts sparkles); `classic` marks the reference's own, which keep
// their original random stream.
import * as O from "./ornament.ts";
import { register } from "./orn_registry.ts";

function kind(name: string, label: string, sparkle: string, classic = false): void {
  register({
    name, slot: "gilt", label, sparkle, classic,
    draw: (pt, _rng, b) => {
      const s = Math.min(b[2] - b[0], b[3] - b[1]);
      O.sparkles(pt, [{ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, r: s * 0.3, kind: sparkle }]);
    },
  });
}

export function registerGilt(): void {
  kind("gilt_cross", "Dotted cross", "cross", true);
  kind("gilt_rosette", "Four-dot rosette", "rosette", true);
  kind("gilt_dotted", "Dotted sparkle", "dotted", true);
  kind("gilt_lozenge", "Lozenge", "lozenge", true);
  kind("gilt_star", "Five-pointed star", "star5");
  kind("gilt_crescent", "Crescent", "crescent");
  kind("gilt_trefoil", "Trefoil", "trefoil");
}
