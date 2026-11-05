// Where a growing garden (garden.ts) is drawn on the GPU (meshgl.ts), as
// Surface is with Canvas2D: canvases a tile tall down the scene. Each piece
// on a tile still changing is a mesh of its own, and each frame such a
// tile is painted afresh, paper first and then every piece on it in its
// layer (Z, pieces.ts), in the order the pieces are laid down, each at its
// own growth: as the finished page is painted, ink over ink, at every
// frame. The frame is drawn once on a canvas of the GPU's and copied onto
// the tile. A tile nothing more can land on (Garden.settledTo) with
// nothing being laid down on it is painted a last time, keeps what it
// shows, and lets go of its meshes.
//
// Meshes are made within a budget of time per frame, those of the tiles
// in view first, then of those nearest them; a tile is painted only once
// all it shows has its mesh, and until then shows what it did.
import { drawCanvas2D } from "../canvas2d.ts";
import { meshOf, type Mesh } from "../mesh.ts";
import { MeshRenderer } from "../meshgl.ts";
import type { Piece } from "./pieces.ts";
import type { SurfaceOptions } from "./surface.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Tile {
  readonly y: number;
  readonly h: number;
  readonly view: Ctx;
  // What lands on it, in the order it is painted, and their meshes; once
  // settled, neither.
  pieces: Piece[];
  readonly ids: Set<number>;
  readonly meshes: Map<number, Mesh>;
  // The tick it was last painted at; whether it shows other than its
  // pieces did then (one has landed since); whether it is to be painted
  // a last time, and whether it has been.
  at: number;
  dirty: boolean;
  closing: boolean;
  settled: boolean;
}

// The order pieces are painted in: by layer, then as they are laid down.
const before = (a: Piece, b: Piece) => a.z - b.z || a.end - b.end || a.id - b.id;

export class MeshSurface {
  readonly o: SurfaceOptions;
  private readonly tiles: Tile[];
  private readonly gl: OffscreenCanvas;
  private readonly r: MeshRenderer;
  private readonly w: number;
  private readonly paper: string;

  // The ms of meshes made at most per frame.
  private readonly budget: number;

  // Throws if the browser has no WebGL2 (Surface draws without it).
  constructor(o: SurfaceOptions & { readonly budget?: number }) {
    this.o = o;
    this.budget = o.budget ?? 8;
    const w = Math.round(o.width * o.scale);
    this.w = w;
    this.paper = `rgb(${o.paper.map((c) => Math.round(c * 255)).join(",")})`;
    // The GPU's canvas first, so none of the tiles' is made without it.
    this.gl = new OffscreenCanvas(w, Math.max(1, ...o.tiles.map((t) => Math.round(t.h * o.scale))));
    this.r = new MeshRenderer(this.gl);
    this.tiles = o.tiles.map((t, i) => {
      const h = Math.round(t.h * o.scale);
      const c = o.canvas(i, w, h);
      const view = c.getContext("2d") as Ctx | null;
      if (view === null) throw new Error("grow: no 2D canvas");
      view.fillStyle = this.paper;
      view.fillRect(0, 0, w, h);
      return { y: t.y, h: t.h, view, pieces: [], ids: new Set(), meshes: new Map(), at: -Infinity, dirty: false, closing: false, settled: false };
    });
  }

  private under(p: Piece): Tile[] {
    return this.tiles.filter((t) => p.box[3] > t.y && p.box[1] < t.y + t.h);
  }

  // Note that piece p lands where it reaches.
  private track(p: Piece): void {
    for (const t of this.under(p)) {
      if (t.ids.has(p.id)) continue;
      t.ids.add(p.id);
      t.dirty = true;
      if (t.settled) {
        // Nothing should land on a settled tile; painted over all if it does.
        drawCanvas2D(t.view, p.tl.at(Infinity), { scale: this.o.scale, y0: t.y, clear: false });
        continue;
      }
      let i = t.pieces.length;
      while (i > 0 && before(t.pieces[i - 1], p) > 0) i--;
      t.pieces.splice(i, 0, p);
    }
  }

  // Pieces laid down.
  lay(pieces: readonly Piece[]): void {
    for (const p of pieces) this.track(p);
  }

  // Make the meshes of what tile t shows at `tick` until `until` (ms);
  // whether all are made.
  private ready(t: Tile, tick: number, until: number): boolean {
    const win = [0, t.y, this.o.width, t.y + t.h] as const;
    for (const p of t.pieces) {
      if (p.start > tick || t.meshes.has(p.id)) continue;
      if (performance.now() > until) return false;
      t.meshes.set(p.id, meshOf(p.tl, this.o.scale, win));
    }
    return true;
  }

  // Paint tile t at tick `tick`, its meshes made.
  private paint(t: Tile, tick: number): void {
    const h = Math.round(t.h * this.o.scale);
    let drawn = 0;
    for (const p of t.pieces) {
      const m = t.meshes.get(p.id);
      if (p.start > tick || m === undefined) continue;
      const u = tick >= p.end ? Infinity : Math.max(0, (tick - p.start) * p.rate);
      this.r.draw(m, u, { y0: t.y, background: this.o.paper, keep: drawn > 0 });
      drawn++;
    }
    if (drawn === 0) {
      t.view.fillStyle = this.paper;
      t.view.fillRect(0, 0, this.w, h);
    } else {
      t.view.globalCompositeOperation = "copy";
      t.view.drawImage(this.gl, 0, 0, this.w, h, 0, 0, this.w, h);
      t.view.globalCompositeOperation = "source-over";
    }
    t.dirty = false;
    t.at = tick;
  }

  // Whether tile t would show other at `tick` than it last did.
  private stale(t: Tile, tick: number): boolean {
    return t.dirty || t.pieces.some((p) => p.start <= tick && p.end > t.at);
  }

  // Paint tile t a last time and let go of its meshes.
  private close(t: Tile, tick: number): void {
    if (this.stale(t, tick)) this.paint(t, tick);
    for (const m of t.meshes.values()) this.r.release(m);
    t.meshes.clear();
    t.pieces = [];
    t.settled = true;
  }

  // Show tick `tick` on the tiles reaching scene rows y0..y1 (all, by
  // default), with `live` the pieces being laid down; then, as time allows,
  // make ready the tiles nearest them and paint a last time those settled.
  show(live: readonly Piece[], tick: number, y0 = -Infinity, y1 = Infinity): void {
    for (const p of live) this.track(p);
    const until = performance.now() + this.budget;
    const mid = Number.isFinite(y0) && Number.isFinite(y1) ? (y0 + y1) / 2 : 0;
    const seen = (t: Tile) => t.y + t.h > y0 && t.y < y1;
    const order = this.tiles.filter((t) => !t.settled).sort((a, b) => Number(seen(b)) - Number(seen(a)) || Math.abs(a.y + a.h / 2 - mid) - Math.abs(b.y + b.h / 2 - mid));
    for (const t of order) {
      if (!t.closing && !(seen(t) ? this.stale(t, tick) : t.pieces.some((p) => p.start <= tick && !t.meshes.has(p.id)))) continue;
      if (!this.ready(t, tick, until)) {
        if (performance.now() > until) break;
        continue;
      }
      if (t.closing) this.close(t, tick);
      else if (seen(t)) this.paint(t, tick);
    }
  }

  // The tiles wholly above scene row y with nothing being laid down on
  // them at tick `tick` are painted a last time, as show finds time.
  merge(y: number, tick: number): void {
    for (const t of this.tiles) {
      if (t.settled || t.closing || t.y + t.h > y || t.pieces.some((p) => tick < p.end)) continue;
      t.closing = true;
    }
  }

  // Whether tiles wait to be made ready or painted a last time, at `tick`.
  pending(tick: number): boolean {
    return this.tiles.some((t) => !t.settled && (t.closing || t.pieces.some((p) => p.start <= tick && !t.meshes.has(p.id))));
  }

  // How many meshes are held, for the playground's counters.
  get held(): number {
    let n = 0;
    for (const t of this.tiles) n += t.meshes.size;
    return n;
  }
}
