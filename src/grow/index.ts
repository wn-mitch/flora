// Gardens grown online (garden.ts): a plant that grows into any region as
// it is watched, drawn onto canvases a tile at a time (surface.ts, or on
// the GPU meshsurface.ts).
export { Garden, type GardenOptions, type Rect } from "./garden.ts";
export { Surface, type SurfaceOptions } from "./surface.ts";
export { MeshSurface } from "./meshsurface.ts";
export { frameOf, Z, type Piece, type Box } from "./pieces.ts";
export type { Crossing } from "./weave.ts";
