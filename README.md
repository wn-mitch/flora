# web-flora

Procedural watercolour flora for web pages. web-flora grows the plants of
[tikz-flora](https://flora.alpacasoft.dev), a LuaLaTeX package, and draws
them with WebGL2, or with a 2D canvas where WebGL2 is missing. Given the
same seed it grows the same plant as the package does inside LuaLaTeX.
The margins of [flora.alpacasoft.dev](https://flora.alpacasoft.dev) are
grown with it.

```sh
npm install @alpaca-software/web-flora
```

## A plant in a margin

```js
import { compose, Painter } from "@alpaca-software/web-flora/engine";
import { toDisplayList, WebGLRenderer } from "@alpaca-software/web-flora";

// A margin 160 x 900 pt, its column of text from x = 130.
const text = { x0: 130, y0: 24, x1: 160, y1: 876 };
const spec = { width: 160, height: 900, seed: 7, text, lines: [text] };
const pt = new Painter({ width: 160, height: 900 });
compose.plant(spec, pt);

// Onto a 160 x 900 canvas.
const canvas = document.querySelector("canvas");
const list = toDisplayList(pt.scene());
new WebGLRenderer(canvas).draw(list, { scale: 1 });
```

The package has two entry points:

- `@alpaca-software/web-flora/engine` grows and paints:
  - `compose.plant` grows one plant into a margin.
  - `compose.page` grows a whole page in any of tikz-flora's layouts.
    Pass `{ progress: (f) => ... }` to hear how far it has got, from 0
    to 1.
  - `ornaments.draw` sets a single ornament.
- `@alpaca-software/web-flora` turns a painted scene into a display list
  (`toDisplayList`) and draws it (`WebGLRenderer`, `drawCanvas2D`).

The engine runs in Node too, without a canvas: everything up to the
display list needs no DOM.

## Relation to tikz-flora

web-flora is a port of tikz-flora's Lua generator. Its test suite runs
every case against the Lua and requires the random streams to match
exactly, and the geometry and colour within floating-point tolerance. The
same TypeScript also builds to Lua 5.3 and LuaJIT.

The package ships ES2022 JavaScript with type declarations and source
maps. MIT licence.
