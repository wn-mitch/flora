# web-flora

web-flora generates watercolour plants and draws them on a canvas. You
give it a page size and the box your text occupies; it grows a plant in
the margin beside the text, with stems, leaves, blooms and gilt
ornaments, and keeps everything clear of the text. The same seed always
grows the same plant.

Drawing uses WebGL2, with a 2D canvas renderer for browsers without it.
Growing a plant needs no DOM, so it also runs in Node and in Web Workers.

```sh
npm install @alpaca-software/web-flora
```

## Draw a plant

```js
import { compose, Painter } from "@alpaca-software/web-flora/engine";
import { toDisplayList, WebGLRenderer } from "@alpaca-software/web-flora";

// A margin 160 x 900 units. The text column starts at x = 130, so the
// plant grows in the 130 units to its left.
const text = { x0: 130, y0: 24, x1: 160, y1: 876 };
const spec = { width: 160, height: 900, seed: 7, text, lines: [text] };
const pt = new Painter({ width: 160, height: 900 });
compose.plant(spec, pt);

// Onto a 160 x 900 canvas, one device pixel per unit.
const canvas = document.querySelector("canvas");
new WebGLRenderer(canvas).draw(toDisplayList(pt.scene()), { scale: 1 });
```

Growing and drawing are separate steps. `compose.plant` paints into the
`Painter`, which records the result as a scene. `toDisplayList` turns the
scene into a display list, and a renderer draws the list onto a canvas.
You can draw one display list many times, at any scale. `scale` is
device pixels per unit, so for a sharp picture on a high-density screen,
size the canvas to `width * devicePixelRatio` by
`height * devicePixelRatio` pixels and pass `scale: devicePixelRatio`.

## The spec

A spec describes the page the plant grows on.

| Field | Meaning |
| --- | --- |
| `width`, `height` | The page size, in your own units. |
| `text` | The box the text occupies, `{ x0, y0, x1, y1 }`. The plant grows in the margin to the left of `text.x0`. |
| `lines` | Boxes the plant must not cover, such as each line of text. |
| `seed` | Any number or string. The same seed and spec give the same plant. |

Spec coordinates start at the bottom-left corner of the page, and y
increases upward. Display lists and canvases start at the top-left, with
y increasing downward; the `Painter` converts between them.

To grow the plant on the right-hand side instead, mirror the page with
the painter's frame while it grows:

```js
pt.frame((x, y) => [spec.width - x, y]);
compose.plant(spec, pt);
pt.frame(undefined);
```

## Whole pages and layouts

`compose.page` grows every plant a page needs, in one of these layouts:
`left`, `right`, `centered`, `split`, `title`, `surround`, `flank`,
`wreath`, `bouquet` and `scrollwork`.

```js
const page = compose.page({
  width: 595, height: 842, seed: 3, layout: "wreath",
  text: { x0: 162, y0: 120, x1: 436, y1: 720 },
  lines: [],
});
const list = toDisplayList(page.pt.scene());
```

A page can take a few hundred milliseconds to grow. To show progress,
pass a callback. It receives a number from 0 to 1 that only increases
and ends at exactly 1:

```js
compose.page(spec, { progress: (f) => { bar.value = f; } });
```

To keep your page responsive, grow and draw in a Web Worker:
`WebGLRenderer` and `drawCanvas2D` both accept an `OffscreenCanvas`.

## Inks

Every part of a plant (blooms, leaves, stems and so on) has its own ink.
Eight colourways set all of them at once: `original`, `spring`,
`summer`, `autumn`, `winter`, `ember`, `plum` and `rose`.

```js
import { inks, tune } from "@alpaca-software/web-flora/engine";

// For one plant, through the painter:
const pt = new Painter({ width: 160, height: 900, palette: { ...tune.PALETTE, ...inks.COLOURWAYS.spring } });

// For a page, in the spec:
compose.page({ ...spec, palette: inks.COLOURWAYS.spring });
```

## Browsers without WebGL2

`new WebGLRenderer(canvas)` throws when the browser cannot create a
WebGL2 context. Draw with the 2D canvas renderer instead:

```js
import { drawCanvas2D } from "@alpaca-software/web-flora";

try {
  new WebGLRenderer(canvas).draw(list, { scale: devicePixelRatio });
} catch {
  drawCanvas2D(canvas.getContext("2d"), list, { scale: devicePixelRatio });
}
```

Both renderers draw the same picture, up to antialiasing.

## Package

The package ships ES2022 JavaScript modules with TypeScript declarations
and source maps. It has no runtime dependencies. MIT licence.
