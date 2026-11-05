// Where a growing garden (garden.ts) is drawn: canvases a tile tall down
// the scene (one canvas would pass the browser's size limit on a long
// page). While pieces may still land on a tile, each layer of it (Z,
// pieces.ts) is a canvas of its own, so a piece laid down later in a
// lower layer goes under what is above it; once nothing more can land on
// the tile its layers are merged, back to front, onto its dry canvas and
// let go. A piece laid down is painted once onto the layers it reaches and
// never again. Each frame, a tile something is being laid down on is shown
// as its dry canvas with each layer over it in turn, and the frames of the
// pieces being laid down in a layer painted with it; a tile with nothing
// being laid down keeps what it shows.
import type { RGB } from "../engine/color.ts";
import { drawCanvas2D } from "../canvas2d.ts";
import { LAYERS, type Piece } from "./pieces.ts";

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SurfaceOptions {
  // The scene's size, pt, and device px per pt.
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  // The tiles' tops and heights, pt, covering the scene.
  readonly tiles: readonly { readonly y: number; readonly h: number }[];
  // The paper the paint sits on.
  readonly paper: RGB;
  // The canvas each tile is shown on, sized w x h device px.
  readonly canvas: (i: number, w: number, h: number) => Canvas;
}

interface Tile {
  readonly y: number;
  readonly h: number;
  readonly view: Ctx;
  readonly dry: Ctx;
  // Its layers while pieces may still land on it, each made when first
  // painted on; undefined once merged.
  layers: (Ctx | undefined)[] | undefined;
  // Whether what it shows differs from its dry canvas and layers and what
  // is being laid down on it.
  stale: boolean;
}

export class Surface {
  readonly o: SurfaceOptions;
  private readonly tiles: Tile[];
  private readonly w: number;
  // Where the pieces being laid down in a layer are painted before going
  // over the layers under it, as the layer's own canvas was.
  private wet: Ctx | undefined;

  constructor(o: SurfaceOptions) {
    this.o = o;
    const w = Math.round(o.width * o.scale);
    this.w = w;
    const paper = `rgb(${o.paper.map((c) => Math.round(c * 255)).join(",")})`;
    this.tiles = o.tiles.map((t, i) => {
      const h = Math.round(t.h * o.scale);
      const view = context(o.canvas(i, w, h));
      const dry = context(new OffscreenCanvas(w, h));
      for (const c of [view, dry]) {
        c.fillStyle = paper;
        c.fillRect(0, 0, w, h);
      }
      return { y: t.y, h: t.h, view, dry, layers: Array.from({ length: LAYERS }, () => undefined), stale: false };
    });
  }

  // The tiles piece p reaches.
  private under(p: Piece): Tile[] {
    return this.tiles.filter((t) => p.box[3] > t.y && p.box[1] < t.y + t.h);
  }

  // Paint finished pieces onto the layers they are in.
  lay(pieces: readonly Piece[]): void {
    for (const p of pieces) {
      const list = p.tl.at(Infinity);
      for (const t of this.under(p)) {
        // A tile merged takes it straight onto its dry canvas, over all.
        let c = t.dry;
        if (t.layers !== undefined) {
          c = t.layers[p.z] ?? context(new OffscreenCanvas(this.w, t.dry.canvas.height));
          t.layers[p.z] = c;
        }
        drawCanvas2D(c, list, { scale: this.o.scale, y0: t.y, clear: false });
        t.stale = true;
      }
    }
  }

  // Merge the layers of the tiles wholly above scene row y, where nothing
  // more will land (Garden.settledTo), onto their dry canvases.
  merge(y: number): void {
    for (const t of this.tiles) {
      if (t.layers === undefined || t.y + t.h > y) continue;
      for (const c of t.layers) if (c !== undefined) t.dry.drawImage(c.canvas, 0, 0);
      t.layers = undefined;
    }
  }

  // How many layer canvases are held, for the playground's counters.
  get held(): number {
    let n = 0;
    for (const t of this.tiles) for (const c of t.layers ?? []) if (c !== undefined) n++;
    return n;
  }

  // Show tick `tick` on the tiles reaching scene rows y0..y1 (all, by
  // default), with `live` the pieces being laid down, by start.
  show(live: readonly Piece[], tick: number, y0 = -Infinity, y1 = Infinity): void {
    for (const t of this.tiles) {
      if (t.y + t.h <= y0 || t.y >= y1) continue;
      const on = live.filter((p) => p.box[3] > t.y && p.box[1] < t.y + t.h);
      if (on.length === 0 && !t.stale) continue;
      const v = t.view;
      v.globalCompositeOperation = "copy";
      v.drawImage(t.dry.canvas, 0, 0);
      v.globalCompositeOperation = "source-over";
      const win = [0, t.y, this.o.width, t.y + t.h] as const;
      for (let z = 0; z < LAYERS; z++) {
        const c = t.layers?.[z];
        const wet = on.filter((p) => p.z === z);
        const frame = (into: Ctx) => {
          for (const p of wet) drawCanvas2D(into, p.tl.at(Math.max(0, (tick - p.start) * p.rate), win), { scale: this.o.scale, y0: t.y, clear: false });
        };
        if (wet.length === 0) {
          if (c !== undefined) v.drawImage(c.canvas, 0, 0);
        } else if (t.layers === undefined) {
          // On a merged tile they paint straight over it, as they will dry.
          frame(v);
        } else {
          // The layer with its wet pieces painted on it, as they will dry.
          const sc = this.scratch(v.canvas.width, v.canvas.height);
          sc.clearRect(0, 0, sc.canvas.width, sc.canvas.height);
          if (c !== undefined) sc.drawImage(c.canvas, 0, 0);
          frame(sc);
          v.drawImage(sc.canvas, 0, 0);
        }
      }
      // With something being laid down it shows more than its dry canvas.
      t.stale = on.length > 0;
    }
  }

  private scratch(w: number, h: number): Ctx {
    if (this.wet === undefined || this.wet.canvas.width !== w || this.wet.canvas.height !== h) this.wet = context(new OffscreenCanvas(w, h));
    return this.wet;
  }
}

function context(c: Canvas): Ctx {
  const x = c.getContext("2d") as Ctx | null;
  if (x === null) throw new Error("grow: no 2D canvas");
  return x;
}
