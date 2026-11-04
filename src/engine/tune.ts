// Tunable parameters of the generator, in one place so they can be adjusted
// without touching the drawing code. Ranges are [min, max] pairs sampled
// per shape. The ornaments' and gilt's settings join this table when those
// are ported.

export type Range = readonly [number, number];

export const GESTURE = {
  edge: 0.24,               // outer line of the stems, fraction of margin width
  bows: 3,                  // inward bows up the margin; fewer is gentler
  bow_amp: [0.20, 0.33] as Range,   // inward reach of each bow, fraction of margin
  bow_width: [0.34, 0.42] as Range, // half-width of each bow, fraction of its band;
                            // above 0.5 neighbouring bows merge into a flat offset
  density_floor: 0.24,      // spray and leaf density in the quiet stretches
  bow_density: 0.6,         // density at each bow, relative to the hero and the foot (1)
  end_reach: 3,             // reach of the dense hero and foot clusters (hero radii)
};

export const PLANT = {
  root: 0.64,               // where the plant is rooted along the foot, fraction of page width
  lookahead: 82,            // pt ahead on its guide the main stem steers toward; longer is lazier
  bend_radius: 91,          // tightest bend of the main stem, pt
  bend_ease: 23,            // pt over which a bend may build from straight to tightest
  long_shoots: 2,           // shoots that climb with the main stem, crossing it
  shoot_start: [-0.15, 0.3] as Range, // where long shoots leave, share of the rise (below 0: along the foot)
  shoot_end: [0.6, 1.0] as Range,     // where they end, share of the rise; spread evenly between
  shoot_reach: [0.24, 0.36] as Range, // how far long shoots swing across the main stem, fraction of margin
  shoot_wave: [220, 330] as Range,    // length of one swing of a long shoot, pt
  foot_shoots: 5,           // shoots fanning up from the foot and corner
  foot_reach: [34, 70] as Range,      // length of those shoots, pt
  shoot_bend: 29,           // tightest bend of a shoot to a bloom or leaf, pt
  root_width: 5.8,          // main stem width at the root, pt
  tip_width: 3,             // narrowest the main stem gets, pt
  fork_ratio: 0.8,          // width of a long shoot relative to its parent
  stem_l: 0.25,             // OKLCH lightness of the main stem and long shoots
  stem_brush: 1,            // brushwork along those stems; 0 paints them flat
};

export const HERO = {
  style: "wedge",           // bloom style (BLOOMS): fan, round, soft, obovate or wedge
  petals: 5,                // petals of the hero bloom
  petal_width: 0.35,        // petal half-width, fraction of the bloom's radius
  rotation: -1,             // turn of the first petal, degrees; negative picks one per seed
  lost_edges: 0.56,         // share of each petal's outline lost
  tilt: 35,                 // how far the bloom leans back, top away, degrees
};

export interface BloomStyle {
  readonly weight: number;
  readonly petals: Range;
  readonly width: Range;
  readonly ragged: number;
  readonly spacing: number;
  readonly rim: number;
  readonly rays: Range;
  readonly ray_reach: Range;
  readonly ray_contrast: Range;
  readonly veins: Range;
  readonly gap?: number;
  readonly eye_fade?: number;
  readonly backruns?: number;
}

// Bloom styles. Each bloom picks a style by weight and draws its own count,
// width and so on from the style's ranges.
export const BLOOMS: Readonly<Record<string, BloomStyle>> = {
  fan: { weight: 3, petals: [5, 6], width: [0.32, 0.40], ragged: 0.10, spacing: 0.10,
    rim: 0.16, rays: [28, 44], ray_reach: [0.25, 0.85], ray_contrast: [0.35, 0.70], veins: [10, 18] },
  round: { weight: 2, petals: [5, 5], width: [0.52, 0.58], ragged: 0.08, spacing: 0.12,
    rim: 0.07, rays: [0, 0], ray_reach: [0.30, 0.80], ray_contrast: [0.45, 0.80], veins: [22, 22] },
  soft: { weight: 2, petals: [5, 5], width: [0.62, 0.72], ragged: 0.08, spacing: 0.12,
    rim: 0.07, rays: [0, 0], ray_reach: [0.30, 0.80], ray_contrast: [0.45, 0.80], veins: [12, 12] },
  obovate: { weight: 0, petals: [5, 5], width: [0.30, 0.36], ragged: 0.08, spacing: 0.12,
    rim: 0.11, rays: [0, 0], ray_reach: [0.30, 0.80], ray_contrast: [0.45, 0.80], veins: [22, 22] },
  wedge: { weight: 3.2, petals: [5, 5], width: [0.35, 0.44], ragged: 0.15, spacing: 0.09,
    rim: 0.12, rays: [30, 44], ray_reach: [0.25, 0.6], ray_contrast: [0.4, 0.6], veins: [12, 18],
    gap: 0.08, eye_fade: 0.28, backruns: 0.8 },
};

export const COMPOSE = {
  hero: 0.5,                // hero bloom radius, fraction of margin width
  features: [1.0, 1.3] as Range,      // size of the lily, umbels and other large blooms, picked per bloom
  leaves: 100,              // most large leaves on a page
  leaf_size: 1.25,          // length of large leaves
  leaf_width: [0.17, 0.23] as Range,  // half-width of a large leaf, share of its length, picked per leaf
  leaf_overlap: 0.45,       // how far leaves may grow across each other, 0-1
  leaf_spacing: [26, 44] as Range,    // pt between leaf nodes along a stem, picked per node; wider where quiet
  hole_min: 7,              // smallest hole, pt radius, that gets a bloom or spray; raised where quiet
  sprays: 150,              // most fine sprays on a page
  small_blooms: 6,          // small blooms the sprays may add
  curls: 0.45,              // how often tendrils and loop flourishes appear
  leaflet_spacing: [40, 72] as Range, // pt between small leaflets along the stems, picked per gap
  leaflet_size: 17.5,       // length of those leaflets, pt
};

// How much of each kind of growth a page gets (mix.ts): 1 is the usual
// amount, 0 none.
export const MIX: Readonly<Record<string, number>> = {
  bloom: 1, soft: 1, lily: 1, ghost: 1, umbel: 1, cyme: 1, gyps: 1,
  leaves: 1, leaflets: 1, sprays: 1, curls: 1, density: 1,
  feather: 1, acanthus: 1, lance: 1, fan: 1, round: 1,
  bee: 0, butterfly: 0, bird: 0, snail: 0,
};

export interface SizeCurve {
  readonly range: Range;
  readonly points: readonly Range[];
}

// Size distributions: a smooth curve through control points [x, weight],
// x running 0-1 across the range, so each kind of element comes in a mix
// of sizes.
export const SIZES: Readonly<Record<string, SizeCurve>> = {
  gyps: { range: [0.3, 1.0], points: [[0, 0.35], [0.25, 0.8], [0.5, 1.0], [0.75, 0.75], [1, 0.5]] },
  leaf: { range: [0.35, 1.3], points: [[0, 0.4], [0.25, 0.9], [0.5, 1.0], [0.75, 0.6], [1, 0.3]] },
  leaflet: { range: [0.5, 2.0], points: [[0, 0.6], [0.25, 1.0], [0.5, 0.7], [0.75, 0.35], [1, 0.15]] },
};

export interface Look {
  readonly base_l: Range;
  readonly tip_l: Range;
  readonly chroma: Range;
  readonly curve: Range;
}

// What paints each part: "look" (the gradients of COLOR.looks), an ink group
// (blue, blue-grey, teal, green, violet, warm, earth, gold) or one ink by
// name (inks.ts). Inks keep the look's lightness.
export type Palette = Readonly<Record<string, string>>;

export const PALETTE: Palette = {
  hero: "look", blooms: "look", leaves: "blue", leaflets: "blue", stems: "chiku-rin",
  sprays: "look", ghost: "look", cartouche: "look",
};

export const COLOR = {
  hue: 263,                 // OKLCH hue of the deep tones (ultramarine)
  hue_jitter: 6,            // per-shape hue variation, degrees either way
  hue_drift: -24,           // base hue relative to tip (negative: cerulean)
  grey_chance: 0.12,        // chance a leaf is a muted grey-blue
  grey_share: 0.25,         // chroma kept by a grey-blue leaf
  looks: {
    vivid: { base_l: [0.80, 0.90], tip_l: [0.2, 0.32], chroma: [0.65, 1.00], curve: [0.4, 1.3] },
    hero: { base_l: [0.74, 1], tip_l: [0.36, 0.48], chroma: [0.81, 1], curve: [0.35, 0.75] },
    fan: { base_l: [0.68, 0.80], tip_l: [0.36, 0.50], chroma: [0.80, 1.00], curve: [0.35, 0.80] },
    soft: { base_l: [0.95, 0.99], tip_l: [0.48, 0.68], chroma: [0.40, 0.85], curve: [0.8, 1.8] },
    ghost: { base_l: [0.97, 0.99], tip_l: [0.83, 0.88], chroma: [0.25, 0.3], curve: [1, 1.2] },
    leaf: { base_l: [0.66, 0.8], tip_l: [0.32, 0.65], chroma: [0.65, 1], curve: [0.4, 2.2] },
  } as Readonly<Record<string, Look>>,
};

export const WASH = {
  blotches: [2, 4] as Range,          // variegated glazes per shape
  blotch_opacity: [0.10, 0.24] as Range,
  lifts: [0, 1] as Range,             // pale back-run blooms per shape
  lift_opacity: [0.18, 0.32] as Range,
  blotch_hue: 10,           // hue shift of a glaze from its shape, degrees
  tideline_chance: 0.55,    // pooled pigment along part of the contour
  streak_scale: 0.05,       // multiplier on each look's crisp white streaks
  brush_bands: [5, 10] as Range,      // broken pigment bands per shape
  brush_pale: [10, 20] as Range,      // broken pale striations per shape
  brush_width: 1.0,         // width multiplier for both
  brush_gap: 0.35,          // how much of each stroke is left unpainted
  brush_dry: 0.3,           // chance a stroke piece splits into threads
  band_opacity: [0.38, 0.62] as Range,
  pale_contrast: [0.12, 0.65] as Range, // opacity of pale streaks: barely to clearly lighter
  vein_contrast: [0.15, 0.55] as Range, // opacity of leaf side veins
  lost_edges: 0.42,         // share of each contour whose edge is lost
  lost_fade: 1.0,           // how far a lost edge's wash fades into the paper
  grain_clump: 0.55,        // share of granulation specks gathered into clumps
  grain_mottle: 0.8,        // strength of the tonal mottling under the specks
  vein_opacity: 0.34,       // dark vein lines along each petal
};

// How often each ornament kind is picked for its place on the page,
// against the other kinds for that place: 0 never. \florasetup{ornaments=
// {...}} overrides these per document.
export const ORNAMENTS: Readonly<Record<string, number>> = {
  night: 3, sun: 1, moon: 1, constellation: 1, planet: 1, armillary: 1, scrolled: 1, strapwork: 1,
  compass: 3, rosette: 1, sunburst: 1, quatrefoil: 1,
  knot: 3, medallion: 1, zodiac_pendant: 1,
  sun_crest: 2, compass_rose: 2, armillary_crest: 1, zodiac: 1, wreath: 1,
  swash: 1, fleuron_rule: 1, headpiece: 1, copperplate: 2, swelled_rule: 2, fleuronnee: 1, rinceau: 2,
  cul_de_lampe: 1, hedera: 1, garland: 1,
  bracket: 1, fan: 1, corner_leaf: 1, acanthus_corner: 2, cornerpiece: 2, pen_corner: 1,
  gilt_cross: 4, gilt_rosette: 3, gilt_dotted: 3, gilt_lozenge: 1,
  gilt_star: 1.5, gilt_crescent: 1, gilt_trefoil: 1,
};

// How the painting is laid down as the plant grows (timeline.ts), in pt of
// growth; the front moves a pt of stem per pt. Leaf timings are shares of
// the leaf's length:
//   ink_lag      how far a stem's ink line follows its wash
//   stem_wet     a stem's wet front, shares of its width
//   leaf_wash    the wash flooding a leaf from base to tip
//   leaf_wet     the wet front behind it
//   midrib       when the pen draws the midrib, and how long it takes
//   veins        when the first lateral vein starts, and the spread over
//                which the rest follow toward the tip
//   vein         how long the pen takes over each vein
//   hatch        when the hatching starts, and how long it takes
//   outline      when the pen traces the contour, and how long it takes
//   bloom_delay  growth after the front reaches a bloom before it opens
//   visitor_delay  and a visitor before it arrives
//   gilt_delay   and an ornament, sparkle or the compass before it is laid
export const LAYING = {
  ink_lag: 14,
  stem_wet: 2.5,
  leaf_wash: 1.1,
  leaf_wet: 0.22,
  midrib: [0.75, 0.45] as const,
  veins: [0.95, 0.5] as const,
  vein: 0.18,
  hatch: [1.25, 0.5] as const,
  outline: [1.1, 0.9] as const,
  bloom_delay: 10,
  visitor_delay: 120,
  gilt_delay: 160,
};
