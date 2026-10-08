// KidBus map sprite generator — the checked-in POI sprite is BUILT, not drawn.
//
// Run with:  node scripts/generate-kidbus-sprite.mjs
// Verify:    node scripts/generate-kidbus-sprite.mjs --check   (exit 1 on drift)
//
// ## What it writes
//
//   web/public/map-sprites/kidbus.json      sprite atlas index  (logical pixels)
//   web/public/map-sprites/kidbus.png       @1x atlas (384 x 32)
//   web/public/map-sprites/kidbus@2x.json   @2x atlas index    (pixelRatio 2)
//   web/public/map-sprites/kidbus@2x.png    @2x atlas (768 x 64)
//
// The web console loads the sprite same-origin (`/map-sprites/kidbus`, i.e. the
// `sprite` field of the KidBus styles in `packages/map-assets`, served straight
// out of `web/public/`), and the mobile app resolves the same path against the
// API origin (`mobile/src/features/map/map-style.ts`) — native MapLibre cannot
// resolve a root-relative URL, so the byte-identical files are served by the
// web app on the origin both clients already talk to.
//
// ## Why a real generator instead of ten hand-saved PNGs
//
// The previous sprite used *bare* Maki names (`school`, `hospital`, …) while the
// style asked for `poi-<class>` — MapLibre skips a symbol whose `icon-image` is
// missing from the atlas, so **no POI icon or label rendered anywhere**, web or
// native. Sourcing both sides from one table here (ICONS below) means the ids
// the style names and the ids in the atlas cannot drift apart again, and
// `web/scripts/kidbus-cartography.spec.ts` fails the build if they ever do.
//
// ## Provenance (CC0)
//
// The glyphs are **Maki** icons, CC0 1.0 Universal (public domain dedication),
// by Mapbox, Inc. — https://github.com/mapbox/maki — vendored here as their
// `d` path data at **v8.0.0** (the release the MIT/CC0 note in
// `scripts/THIRD-PARTY-LICENSES.md` names). CC0 needs no attribution; it is
// kept because the repo's third-party asset list names Maki and an asset whose
// source is documented is an asset somebody can audit or replace.
//
// The badge behind each glyph (white ring + category disc) is drawn here, not
// taken from Maki: Google-style POI markers are a coloured disc with a white
// glyph, and the disc colour is what makes a school or a hospital readable at
// z15 before any label loads.
//
// ## Determinism
//
// No network, no npm dependencies, no randomness and no timestamps: the same
// input bytes always produce the same PNG bytes (zlib level 9, fixed row
// filters). `--check` re-renders in memory and diffs byte-for-byte, so CI can
// prove the committed atlas is the generator's output.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the sprite the web app serves (and mobile fetches) lives. */
export const SPRITE_DIR = join(repoRoot, 'web', 'public', 'map-sprites');
export const SPRITE_BASENAME = 'kidbus';

/** One sprite cell, in logical pixels. The @2x atlas is twice this. */
export const SPRITE_CELL = 32;

/** Anti-aliasing: sample this many sub-rows/columns per output pixel. */
const SUPERSAMPLE = 4;

/**
 * Maki v8.0.0 `d` path data (CC0), verbatim minus the XML newline/tab entities
 * and repeated whitespace. Kept inline so generation is offline and pinned.
 */
const MAKI_PATHS = {
  school:
    'M5.542 3.647 3.106 3l.443-1.63a.505.505 0 0 1 .618-.352l1.46.392a.5.5 0 0 1 .355.613l-.44 1.624Zm-4.52 7.356a.496.496 0 0 1-.005-.276l1.819-6.726 2.435.647-1.819 6.726a.499.499 0 0 1-.143.237l-1.457 1.347a.152.152 0 0 1-.247-.066l-.583-1.889ZM10 5c-2.25 0-3-.75-3-3 2.25 0 3 .75 3 3Zm-1.4 7.984c-1.37.21-3.126-1.706-3.52-3.8L5.969 5.9c.399-.35.903-.533 1.419-.533a2.71 2.71 0 0 1 1.564.489.964.964 0 0 0 1.089-.01 2.438 2.438 0 0 1 1.46-.479c.77 0 1.643.489 2.05 1.201 1.536 2.696-1.194 6.709-3.144 6.417a.867.867 0 0 1-.255-.093 1.427 1.427 0 0 0-1.302 0 .866.866 0 0 1-.25.092Z',
  hospital:
    'M7,1C6.4,1,6,1.4,6,2v4H2C1.4,6,1,6.4,1,7v1c0,0.6,0.4,1,1,1h4v4c0,0.6,0.4,1,1,1h1c0.6,0,1-0.4,1-1V9h4c0.6,0,1-0.4,1-1V7c0-0.6-0.4-1-1-1H9V2c0-0.6-0.4-1-1-1H7z',
  fuel:
    'm14 6v5.5c0 .2761-.2239.5-.5.5s-.5-.2239-.5-.5v-2c0-.8284-.6716-1.5-1.5-1.5h-1.5v-6c0-.5523-.4477-1-1-1h-6c-.5523 0-1 .4477-1 1v11c0 .5523.4477 1 1 1h6c.5523 0 1-.4477 1-1v-4h1.5c.2761 0 .5.2239.5.5v2c0 .8284.6716 1.5 1.5 1.5s1.5-.6716 1.5-1.5v-6.5c0-.5523-.4477-1-1-1v-1.51c-.0054-.2722-.2277-.4901-.5-.49-.2816.0047-.5062.2367-.5015.5184.0002.0105.0007.0211.0015.0316v2.45c0 .5523.4477 1 1 1s1-.4477 1-1-.4477-1-1-1zm-5 .5c0 .2761-.2239.5-.5.5h-5c-.2761 0-.5-.2239-.5-.5v-3c0-.2761.2239-.5.5-.5h5c.2761 0 .5.2239.5.5z',
  'place-of-worship':
    'M7.5,0l-2,2v2h4V2L7.5,0z M5.5,4.5L4,6h7L9.5,4.5H5.5z M2,6.5c-0.5523,0-1,0.4477-1,1V13h2V7.5C3,6.9477,2.5523,6.5,2,6.5z M4,6.5V13h7V6.5H4z M13,6.5c-0.5523,0-1,0.4477-1,1V13h2V7.5C14,6.9477,13.5523,6.5,13,6.5z',
  police:
    'M5.5,1L6,2h5l0.5-1H5.5z M6,2.5v1.25c0,0,0,2.75,2.5,2.75S11,3.75,11,3.75V2.5H6z M1.9844,3.9863C1.4329,3.9949,0.9924,4.4485,1,5v4c-0.0001,0.6398,0.5922,1.1152,1.2168,0.9766L5,9.3574V14l5.8789-6.9297C10.7391,7.0294,10.5947,7,10.4414,7H6.5L3,7.7539V5C3.0077,4.4362,2.5481,3.9775,1.9844,3.9863z M11.748,7.7109L6.4121,14H12V8.5586C12,8.2451,11.9061,7.9548,11.748,7.7109z',
  bus:
    'M2 3C2 1.9 2.9 1 4 1H11C12.1 1 13 1.9 13 3V11C13 12 12 12 12 12V13C12 13.55 11.55 14 11 14C10.45 14 10 13.55 10 13V12H5V13C5 13.55 4.55 14 4 14C3.45 14 3 13.55 3 13V12C2 12 2 11 2 11V3ZM3.5 4C3.22 4 3 4.22 3 4.5V7.5C3 7.78 3.22 8 3.5 8H11.5C11.78 8 12 7.78 12 7.5V4.5C12 4.22 11.78 4 11.5 4H3.5ZM4 9C3.45 9 3 9.45 3 10C3 10.55 3.45 11 4 11C4.55 11 5 10.55 5 10C5 9.45 4.55 9 4 9ZM11 9C10.45 9 10 9.45 10 10C10 10.55 10.45 11 11 11C11.55 11 12 10.55 12 10C12 9.45 11.55 9 11 9ZM4 2.5C4 2.78 4.22 3 4.5 3H10.5C10.78 3 11 2.78 11 2.5C11 2.22 10.78 2 10.5 2H4.5C4.22 2 4 2.22 4 2.5Z',
  park:
    'M14,5.75c0.0113-0.6863-0.3798-1.3159-1-1.61C12.9475,3.4906,12.4014,2.9926,11.75,3c-0.0988,0.0079-0.1962,0.0281-0.29,0.06c-0.0607-0.66-0.6449-1.1458-1.3048-1.0851C9.8965,1.9987,9.6526,2.1058,9.46,2.28l0,0c0-0.6904-0.5596-1.25-1.25-1.25S6.96,1.5896,6.96,2.28C6.96,2.28,7,2.3,7,2.33C6.4886,1.8913,5.7184,1.9503,5.2797,2.4618C5.1316,2.6345,5.0347,2.8451,5,3.07C4.8417,3.0195,4.6761,2.9959,4.51,3C3.6816,2.9931,3.0044,3.659,2.9975,4.4874C2.9958,4.6872,3.0341,4.8852,3.11,5.07C2.3175,5.2915,1.8546,6.1136,2.0761,6.9061C2.2163,7.4078,2.6083,7.7998,3.11,7.94c0.2533,0.7829,1.0934,1.2123,1.8763,0.959C5.5216,8.7258,5.9137,8.2659,6,7.71C6.183,7.8691,6.4093,7.9701,6.65,8v5L5,14h5l-1.6-1v-2c0.7381-0.8915,1.6915-1.5799,2.77-2c0.8012,0.1879,1.603-0.3092,1.7909-1.1103C12.9893,7.7686,13.0025,7.6444,13,7.52c0.0029-0.0533,0.0029-0.1067,0-0.16C13.6202,7.0659,14.0113,6.4363,14,5.75z M8.4,10.26V6.82C8.6703,7.3007,9.1785,7.5987,9.73,7.6h0.28c0.0156,0.4391,0.2242,0.849,0.57,1.12C9.7643,9.094,9.0251,9.6162,8.4,10.26z',
  restaurant:
    'M3.5,0l-1,5.5c-0.1464,0.805,1.7815,1.181,1.75,2L4,14c-0.0384,0.9993,1,1,1,1s1.0384-0.0007,1-1L5.75,7.5c-0.0314-0.8176,1.7334-1.1808,1.75-2L6.5,0H6l0.25,4L5.5,4.5L5.25,0h-0.5L4.5,4.5L3.75,4L4,0H3.5z M12,0c-0.7364,0-1.9642,0.6549-2.4551,1.6367C9.1358,2.3731,9,4.0182,9,5v2.5c0,0.8182,1.0909,1,1.5,1L10,14c-0.0905,0.9959,1,1,1,1s1,0,1-1V0z',
  pharmacy:
    'M9.5,4l1.07-1.54c0.0599,0.0046,0.1201,0.0046,0.18,0c0.6904-0.0004,1.2497-0.5603,1.2494-1.2506C11.999,0.519,11.4391-0.0404,10.7487-0.04C10.0584-0.0396,9.499,0.5203,9.4994,1.2106c0,0.0131,0.0002,0.0262,0.0006,0.0394c0,0,0,0.07,0,0.1L7,4H9.5z M12,6V5H3v1l1.5,3.5L3,13v1h9v-1l-1-3.5L12,6z M10,10H8v2H7v-2H5V9h2V7h1v2h2V10z',
  bank:
    'M1,3C0.446,3,0,3.446,0,4v7c0,0.554,0.446,1,1,1h13c0.554,0,1-0.446,1-1V4c0-0.554-0.446-1-1-1H1z M1,4h1.5C2.7761,4,3,4.2239,3,4.5S2.7761,5,2.5,5S2,4.7761,2,4.5L1.5,5C1.7761,5,2,5.2239,2,5.5S1.7761,6,1.5,6S1,5.7761,1,5.5V4z M7.5,4C8.8807,4,10,5.567,10,7.5l0,0C10,9.433,8.8807,11,7.5,11S5,9.433,5,7.5S6.1193,4,7.5,4z M12.5,4H14v1.5C14,5.7761,13.7761,6,13.5,6S13,5.7761,13,5.5S13.2239,5,13.5,5L13,4.5C13,4.7761,12.7761,5,12.5,5S12,4.7761,12,4.5S12.2239,4,12.5,4z M7.5,5.5c-0.323,0-0.5336,0.1088-0.6816,0.25h1.3633C8.0336,5.6088,7.823,5.5,7.5,5.5z M6.625,6C6.5795,6.091,6.5633,6.1711,6.5449,6.25h1.9102C8.4367,6.1711,8.4205,6.091,8.375,6H6.625z M6.5,6.5v0.25h2V6.5H6.5z M6.5,7v0.25h2V7H6.5z M6.5,7.5v0.25h2V7.5H6.5z M6.5,8L6.25,8.25h2L8.5,8H6.5z M6,8.5c0,0,0.0353,0.1024,0.1016,0.25H8.375L8,8.5H6z M1.5,9C1.7761,9,2,9.2239,2,9.5S1.7761,10,1.5,10L2,10.5C2,10.2239,2.2239,10,2.5,10S3,10.2239,3,10.5S2.7761,11,2.5,11H1V9.5C1,9.2239,1.2239,9,1.5,9z M6.2383,9C6.2842,9.0856,6.3144,9.159,6.375,9.25h2.2676C8.7092,9.1121,8.75,9,8.75,9H6.2383z M13.5,9C13.7761,9,14,9.2239,14,9.5V11h-1.5c-0.2761,0-0.5-0.2239-0.5-0.5s0.2239-0.5,0.5-0.5s0.5,0.2239,0.5,0.5l0.5-0.5C13.2239,10,13,9.7761,13,9.5S13.2239,9,13.5,9z M6.5664,9.5c0.0786,0.0912,0.1647,0.1763,0.2598,0.25h1.4199C8.3462,9.6727,8.4338,9.5883,8.5,9.5H6.5664z',
  shop:
    'm13.33 5h-1.83l-.39-2.33c-.1601-.7182-.7017-1.2905-1.41-1.49-.3493-.1124-.7131-.173-1.08-.18h-2.24c-.3669.007-.7307.0676-1.08.18-.7083.1995-1.2499.7718-1.41 1.49l-.39 2.33h-1.83c-.2761-.0017-.5013.2208-.503.497-.0003.0519.0074.1035.023.153l1.88 6.3c.1964.6246.7753 1.0496 1.43 1.05h6c.651-.0047 1.2247-.4289 1.42-1.05l1.88-6.3c.0829-.2634-.0635-.5441-.3269-.627-.0463-.0146-.0945-.0223-.1431-.023zm-8.81 0 .36-2.17c.0807-.3625.3736-.6395.74-.7.2463-.0776.5019-.1213.76-.13h2.24c.2614.0078.5205.0515.77.13.3664.0605.6593.3375.74.7l.35 2.17h-6z',
};

/**
 * The atlas, in draw order. `id` is what the KidBus styles name in
 * `icon-image`; `maki` selects the CC0 glyph (or `dot` for the generic
 * fallback); `badge` is the disc colour (a Google-like category palette).
 *
 * Every id here is asserted against the shipped styles by
 * `web/scripts/kidbus-cartography.spec.ts` — adding an icon to the style
 * without adding a glyph here (or vice versa) fails the build.
 */
export const ICONS = [
  { id: 'poi-school', maki: 'school', badge: '#1a73e8' },
  { id: 'poi-hospital', maki: 'hospital', badge: '#d93025' },
  { id: 'poi-place_of_worship', maki: 'place-of-worship', badge: '#7b1fa2' },
  { id: 'poi-fuel', maki: 'fuel', badge: '#00796b' },
  { id: 'poi-police', maki: 'police', badge: '#3949ab' },
  { id: 'poi-park', maki: 'park', badge: '#188038' },
  { id: 'poi-restaurant', maki: 'restaurant', badge: '#e37400' },
  { id: 'poi-pharmacy', maki: 'pharmacy', badge: '#00897b' },
  { id: 'poi-bank', maki: 'bank', badge: '#5f6368' },
  { id: 'poi-bus', maki: 'bus', badge: '#0b57d0' },
  { id: 'poi-shop', maki: 'shop', badge: '#c2185b' },
  // The `match` default in the style's icon-image: an unknown OpenMapTiles POI
  // class must still draw a marker, never a bare label or a skipped symbol.
  { id: 'poi-default', maki: 'dot', badge: '#5f6368' },
];

/** Every sprite id this generator emits, in atlas order. */
export const SPRITE_ICON_IDS = ICONS.map((icon) => icon.id);

// ── SVG path parsing ────────────────────────────────────────────────────────


/**
 * Converts an SVG elliptical arc to points (SVG 1.1 appendix F.6.5). Maki uses
 * arcs for rounded corners; sampling them directly keeps the parser honest
 * without pulling in a path library.
 */
function arcPoints(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const value = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };
  const startAngle = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaAngle = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  else if (sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;

  const steps = Math.max(2, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 24)));
  const points = [];
  for (let i = 1; i <= steps; i += 1) {
    const theta = startAngle + (deltaAngle * i) / steps;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    points.push({
      x: cx + rx * cosTheta * cosPhi - ry * sinTheta * sinPhi,
      y: cy + rx * cosTheta * sinPhi + ry * sinTheta * cosPhi,
    });
  }
  return points;
}

/** Recursive cubic flattening: subdivide until the control polygon is flat. */
function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, out, depth = 0) {
  const flatness =
    Math.abs(x1 - (x0 + x3) / 2 - (x3 - x0) / 2) + Math.abs(x2 - (x0 + x3) / 2 - (x3 - x0) / 2) / 2;
  const fy =
    Math.abs(y1 - (y0 + y3) / 2 - (y3 - y0) / 2) + Math.abs(y2 - (y0 + y3) / 2 - (y3 - y0) / 2) / 2;
  if (depth >= 12 || (flatness + fy < 0.02 && Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2) < 24)) {
    out.push({ x: x3, y: y3 });
    return;
  }
  const x01 = (x0 + x1) / 2;
  const y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2;
  const y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2;
  const y23 = (y2 + y3) / 2;
  const x012 = (x01 + x12) / 2;
  const y012 = (y01 + y12) / 2;
  const x123 = (x12 + x23) / 2;
  const y123 = (y12 + y23) / 2;
  const xm = (x012 + x123) / 2;
  const ym = (y012 + y123) / 2;
  flattenCubic(x0, y0, x01, y01, x012, y012, xm, ym, out, depth + 1);
  flattenCubic(xm, ym, x123, y123, x23, y23, x3, y3, out, depth + 1);
}

function flattenQuadratic(x0, y0, cx, cy, x1, y1, out) {
  const c1x = x0 + (2 / 3) * (cx - x0);
  const c1y = y0 + (2 / 3) * (cy - y0);
  const c2x = x1 + (2 / 3) * (cx - x1);
  const c2y = y1 + (2 / 3) * (cy - y1);
  flattenCubic(x0, y0, c1x, c1y, c2x, c2y, x1, y1, out);
}

/**
 * Parses SVG path data into closed/open polylines in the path's own user units.
 * Supports the absolute and relative form of M L H V C S Q T A Z — everything
 * Maki's icons use, and nothing else.
 */
export function parsePath(data) {
  const tokens = data.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths = [];
  let current = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubicControl = null;
  let lastQuadControl = null;
  let command = null;
  let i = 0;

  const nextNumber = () => Number(tokens[i++]);
  const push = (px, py) => current.push({ x: px, y: py });
  const endSubpath = () => {
    if (current.length > 1) subpaths.push(current);
    current = [];
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(token)) {
      command = token;
      i += 1;
      if (command === 'Z' || command === 'z') {
        if (current.length > 1) {
          // An explicit closing point keeps the winding rule well defined.
          push(startX, startY);
        }
        endSubpath();
        x = startX;
        y = startY;
        lastCubicControl = null;
        lastQuadControl = null;
        continue;
      }
    } else if (command === null) {
      throw new Error(`path data starts with a number: ${data.slice(0, 24)}`);
    } else if (command === 'M') {
      command = 'L';
    } else if (command === 'm') {
      command = 'l';
    }

    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;

    switch (command.toUpperCase()) {
      case 'M': {
        endSubpath();
        x = ox + nextNumber();
        y = oy + nextNumber();
        startX = x;
        startY = y;
        push(x, y);
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'L': {
        x = ox + nextNumber();
        y = oy + nextNumber();
        push(x, y);
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'H': {
        x = ox + nextNumber();
        push(x, y);
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'V': {
        y = oy + nextNumber();
        push(x, y);
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'C': {
        const c1x = ox + nextNumber();
        const c1y = oy + nextNumber();
        const c2x = ox + nextNumber();
        const c2y = oy + nextNumber();
        const nx = ox + nextNumber();
        const ny = oy + nextNumber();
        flattenCubic(x, y, c1x, c1y, c2x, c2y, nx, ny, current);
        lastCubicControl = { x: c2x, y: c2y };
        lastQuadControl = null;
        x = nx;
        y = ny;
        break;
      }
      case 'S': {
        const c1x = lastCubicControl ? 2 * x - lastCubicControl.x : x;
        const c1y = lastCubicControl ? 2 * y - lastCubicControl.y : y;
        const c2x = ox + nextNumber();
        const c2y = oy + nextNumber();
        const nx = ox + nextNumber();
        const ny = oy + nextNumber();
        flattenCubic(x, y, c1x, c1y, c2x, c2y, nx, ny, current);
        lastCubicControl = { x: c2x, y: c2y };
        lastQuadControl = null;
        x = nx;
        y = ny;
        break;
      }
      case 'Q': {
        const cx = ox + nextNumber();
        const cy = oy + nextNumber();
        const nx = ox + nextNumber();
        const ny = oy + nextNumber();
        flattenQuadratic(x, y, cx, cy, nx, ny, current);
        lastQuadControl = { x: cx, y: cy };
        lastCubicControl = null;
        x = nx;
        y = ny;
        break;
      }
      case 'T': {
        const cx = lastQuadControl ? 2 * x - lastQuadControl.x : x;
        const cy = lastQuadControl ? 2 * y - lastQuadControl.y : y;
        const nx = ox + nextNumber();
        const ny = oy + nextNumber();
        flattenQuadratic(x, y, cx, cy, nx, ny, current);
        lastQuadControl = { x: cx, y: cy };
        lastCubicControl = null;
        x = nx;
        y = ny;
        break;
      }
      case 'A': {
        const rx = nextNumber();
        const ry = nextNumber();
        const rotation = nextNumber();
        const largeArc = nextNumber() !== 0 ? 1 : 0;
        const sweep = nextNumber() !== 0 ? 1 : 0;
        const nx = ox + nextNumber();
        const ny = oy + nextNumber();
        current.push(...arcPoints(x, y, rx, ry, rotation, largeArc, sweep, nx, ny));
        lastCubicControl = null;
        lastQuadControl = null;
        x = nx;
        y = ny;
        break;
      }
      default:
        throw new Error(`unsupported path command: ${command}`);
    }
  }
  endSubpath();
  return subpaths;
}

// ── Rasteriser ──────────────────────────────────────────────────────────────

/** Even-odd winding: true when the sample point is inside the polygon set. */
function insidePolygons(subpaths, px, py) {
  let winding = 0;
  for (const subpath of subpaths) {
    for (let i = 0; i < subpath.length; i += 1) {
      const a = subpath[i];
      const b = subpath[(i + 1) % subpath.length];
      if (a.y <= py) {
        if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) winding += 1;
      } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}

function ring(cx, cy, radius, steps = 96) {
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const theta = (2 * Math.PI * i) / steps;
    points.push({ x: cx + radius * Math.cos(theta), y: cy + radius * Math.sin(theta) });
  }
  return [points];
}

/**
 * Coverage (0..1) of `subpaths` over a `size x size` pixel grid at `scale`
 * device pixels per path unit, offset by `translate`.
 */
function coverage(subpaths, size, scale, translate) {
  const mask = new Float32Array(size * size);
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const y = (py + (sx + 0.5) * step - translate.y) / scale;
      for (let px = 0; px < size; px += 1) {
        let hits = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
          const x = (px + (sy + 0.5) * step - translate.x) / scale;
          if (insidePolygons(subpaths, x, y)) hits += 1;
        }
        if (hits > 0) mask[py * size + px] += hits / samples;
      }
    }
  }
  return mask;
}

/** Source-over composite of one flat colour through a coverage mask. */
function paint(buffer, mask, colour, alpha = 1) {
  const r = parseInt(colour.slice(1, 3), 16) / 255;
  const g = parseInt(colour.slice(3, 5), 16) / 255;
  const b = parseInt(colour.slice(5, 7), 16) / 255;
  for (let i = 0; i < mask.length; i += 1) {
    const a = mask[i] * alpha;
    if (a <= 0) continue;
    const offset = i * 4;
    buffer[offset] = r * a + buffer[offset] * (1 - a);
    buffer[offset + 1] = g * a + buffer[offset + 1] * (1 - a);
    buffer[offset + 2] = b * a + buffer[offset + 2] * (1 - a);
    buffer[offset + 3] = a + buffer[offset + 3] * (1 - a);
  }
}

/** A generic dot glyph, used for the `match` default (`poi-default`). */
function dotGlyph() {
  return ring(7.5, 7.5, 3.4);
}

/**
 * Draws one icon cell. `size` is the cell in device pixels; the badge geometry
 * is expressed in logical cell units (32) and scaled, so @1x and @2x are the
 * same drawing at different resolution — never a resampled bitmap.
 */
function renderIcon(icon, size) {
  const cell = SPRITE_CELL;
  const scale = size / cell;
  const buffer = new Float32Array(size * size * 4);
  const centre = { x: cell / 2, y: cell / 2 };

  // White ring: keeps the badge legible over dark land, dark roads and night.
  paint(buffer, coverage(ring(centre.x, centre.y, 15.4), size, scale, { x: 0, y: 0 }), '#ffffff', 0.92);
  // Category disc.
  paint(buffer, coverage(ring(centre.x, centre.y, 13.2), size, scale, { x: 0, y: 0 }), icon.badge);

  // White glyph. Maki art is drawn in a 15 x 15 box; it is placed in the middle
  // of the 32-unit cell at 15.6 units (a hair larger than the source box, which
  // is what makes it read at 15 logical pixels on screen), nudged 0.2 units
  // down so the disc's heavier top ring does not look like a halo.
  const glyphPath = icon.maki === 'dot' ? dotGlyph() : parsePath(MAKI_PATHS[icon.maki]);
  const glyphBox = 15.6 / 15;
  const glyphOffset = { x: (cell - 15.6) / 2, y: (cell - 15.6) / 2 + 0.2 };
  paint(
    buffer,
    coverage(glyphPath, size, glyphBox * scale, {
      x: glyphOffset.x * scale,
      y: glyphOffset.y * scale,
    }),
    '#ffffff',
  );
  return buffer;
}

/** Float RGBA buffer -> 8-bit RGBA bytes. */
function toRgbaBytes(buffer) {
  const bytes = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(buffer[i] * 255)));
  }
  return bytes;
}

// ── PNG encoder (RGBA, no dependencies) ─────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encodes straight (non-premultiplied) RGBA bytes as a PNG buffer. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none (deterministic, tiny images)
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Atlas assembly ──────────────────────────────────────────────────────────

/** The sprite documents, in logical pixels, as MapLibre expects them. */
function spriteIndex(pixelRatio) {
  const index = {};
  ICONS.forEach((icon, position) => {
    index[icon.id] = {
      width: SPRITE_CELL,
      height: SPRITE_CELL,
      x: position * SPRITE_CELL,
      y: 0,
      pixelRatio,
    };
  });
  return JSON.stringify(index) + '\n';
}

/** Renders one atlas (all icons in a row) at `pixelRatio`. */
function renderAtlas(pixelRatio) {
  const cell = SPRITE_CELL * pixelRatio;
  const width = cell * ICONS.length;
  const height = cell;
  const rgba = Buffer.alloc(width * height * 4);
  ICONS.forEach((icon, position) => {
    const cellBuffer = toRgbaBytes(renderIcon(icon, cell));
    for (let y = 0; y < height; y += 1) {
      cellBuffer.copy(rgba, (y * width + position * cell) * 4, y * cell * 4, (y + 1) * cell * 4);
    }
  });
  return { width, height, png: encodePng(width, height, rgba) };
}

/**
 * The exact file set this generator owns: name -> contents. Deterministic for a
 * given revision — that is what `--check` and the cartography spec rely on.
 */
export function buildKidbusSprite() {
  const files = new Map();
  for (const pixelRatio of [1, 2]) {
    const suffix = pixelRatio === 2 ? '@2x' : '';
    const atlas = renderAtlas(pixelRatio);
    files.set(`kidbus${suffix}.json`, spriteIndex(pixelRatio));
    files.set(`kidbus${suffix}.png`, atlas.png);
  }
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const files = buildKidbusSprite();
  const drifted = [];
  for (const [name, contents] of files) {
    const target = join(SPRITE_DIR, name);
    const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
    if (check) {
      let current = null;
      try {
        current = readFileSync(target);
      } catch {
        current = null;
      }
      if (current === null || !current.equals(next)) drifted.push(name);
      continue;
    }
    writeFileSync(target, next);
    console.log(`wrote ${relative(repoRoot, target)} (${next.length} bytes)`);
  }
  if (!check) return;
  if (drifted.length > 0) {
    console.error(
      `sprite drift: ${drifted.join(', ')} do not match the generator — run ` +
        '`node scripts/generate-kidbus-sprite.mjs`',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`sprite up to date (${files.size} files, ${SPRITE_ICON_IDS.length} icons)`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
