// Draws a display list with the 2D canvas API: the fallback where WebGL2
// is missing, and the reference the WebGL renderer is tested against.

import { CLOSE, CUBIC, LINE, MOVE, type Blend, type DisplayList, type Image, type Item, type Paint, type Path } from "./display.ts";
import { reaches } from "./flatten.ts";
import type { DrawOptions } from "./webgl.ts";

const COMPOSITE: Record<Blend, GlobalCompositeOperation> = { normal: "source-over", multiply: "multiply", screen: "screen" };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function toPath2D(path: Path): Path2D {
  const p = new Path2D();
  const { verbs, coords } = path;
  let k = 0;
  for (let i = 0; i < verbs.length; i++) {
    switch (verbs[i]) {
      case MOVE: p.moveTo(coords[k], coords[k + 1]); k += 2; break;
      case LINE: p.lineTo(coords[k], coords[k + 1]); k += 2; break;
      case CUBIC: p.bezierCurveTo(coords[k], coords[k + 1], coords[k + 2], coords[k + 3], coords[k + 4], coords[k + 5]); k += 6; break;
      case CLOSE: p.closePath(); break;
      default: throw new Error(`path: unknown verb ${verbs[i]}`);
    }
  }
  return p;
}

// Draw `list` on `ctx`, whose canvas it covers, under the same options as
// WebGLRenderer.draw.
export function drawCanvas2D(ctx: Ctx, list: DisplayList, o: DrawOptions): void {
  const s = o.scale;
  const images = new Map<Image, OffscreenCanvas>();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  if (o.background) {
    const [r, g, b] = o.background;
    ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  } else {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.setTransform(s, 0, 0, s, -(o.x0 ?? 0) * s, -(o.y0 ?? 0) * s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const style = (p: Paint): string | CanvasGradient => {
    if (p.kind === "solid") return rgb(p.rgb);
    const g = ctx.createLinearGradient(p.from[0], p.from[1], p.to[0], p.to[1]);
    for (const st of p.stops) g.addColorStop(Math.min(1, Math.max(0, st.offset)), rgb(st.rgb));
    return g;
  };
  // Items that cannot reach the canvas are skipped (flatten.ts reaches).
  const view = { scale: s, x0: o.x0 ?? 0, y0: o.y0 ?? 0 }, W = ctx.canvas.width, H = ctx.canvas.height;
  const draw = (items: readonly Item[]) => {
    for (const it of items) {
      if (!reaches(it, view, W, H)) continue;
      if (it.kind === "clip") {
        ctx.save();
        ctx.clip(toPath2D(it.path), it.rule);
        draw(it.items);
        ctx.restore();
        continue;
      }
      ctx.globalAlpha = it.alpha;
      ctx.globalCompositeOperation = COMPOSITE[it.blend];
      if (it.kind === "fill") {
        ctx.fillStyle = style(it.paint);
        ctx.fill(toPath2D(it.path), it.rule);
      } else if (it.kind === "stroke") {
        ctx.strokeStyle = rgb(it.rgb);
        ctx.lineWidth = Math.max(it.width, 1 / s);
        ctx.stroke(toPath2D(it.path));
      } else {
        let bm = images.get(it);
        if (!bm) {
          bm = new OffscreenCanvas(it.width, it.height);
          bm.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(it.rgba), it.width, it.height), 0, 0);
          images.set(it, bm);
        }
        ctx.save();
        ctx.transform(...it.transform);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bm, 0, 0, 1, 1);
        ctx.restore();
      }
    }
  };
  draw(list.items);
  ctx.restore();
}

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}
