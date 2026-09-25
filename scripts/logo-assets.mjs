#!/usr/bin/env node
/**
 * Brand artwork pipeline: cleans the VTracer sliver noise out of the vector
 * copies of the logo and rasterises every PNG slot the mobile app and the web
 * app ship.
 *
 * Two jobs, in order:
 *
 * 1. **Sliver cleanup (`cleanVectorCopies`)**. The VTracer trace that the
 *    artwork comes from left eight stray cream paths (`#FBF1CE`-`#FEF8DB`,
 *    8-23px across) lying *across* the pin's silhouette. Where they overhang
 *    the pin they render as cream flecks along the taper — the "cut edge" look.
 *    They are described as noise because every one of them is a 1-2px sliver
 *    hugging the silhouette boundary: the check below only accepts a path when
 *    it is cream, tiny, mostly *outside* the silhouette and never more than 2px
 *    away from it. Bus, wheels, windows, pin, wordmark and every brand colour
 *    are untouched — this only deletes the flecks.
 *
 * 2. **PNG rendering (`TILES`)**. Every tile is drawn as one SVG (canvas +
 *    background + artwork at a computed offset) and rasterised at 4x, then
 *    downscaled with a Lanczos-3 filter. Rendering at 1x/2x — what the assets
 *    shipped with — is what made the curved pin edges look rough; the 4x
 *    supersample gives smooth anti-aliased edges at every size (1024, 96, 48,
 *    16px).
 *
 * Sizes are declared as fill fractions with the margins they produce, so the
 * "does anything look cut?" question is answered by arithmetic, not by eye:
 *
 *   - icon.png      cream #F7F7F2, mark at 76% of the tile height -> 12% clear
 *                   above and below, 18.3% either side. (Was: mark + wordmark
 *                   lockup at 80% of the width, ~2% top/bottom.)
 *   - adaptive-icon.png  transparent, mark at 59% of the height (604px of 1024
 *                   = 57dp). Android masks adaptive layers to a circle whose
 *                   safe zone is 66dp of the 108dp canvas = 61.1% -> 625.8px of
 *                   1024, a 312.9px radius. The mark reaches 302px from centre,
 *                   so 10.9px stays clear above and 11.9px below the circle.
 *                   (Was 61.1%: 626px tall, tangent to the circle — 0.1px of
 *                   clearance above, 0.9px below, 158 artwork pixels clipped.)
 *   - splash.png    cream #F7F7F2, lockup at 70% of the width, centred. The
 *                   lockup's own cream card blends into the canvas, leaving
 *                   mark + wordmark on off-white. (Was 60% on navy #0F172A.)
 *   - favicon.png   transparent, mark at 75% of the height -> a 6px margin all
 *                   round at 48px. (Was edge-to-edge: 0 margin.)
 *   - web/src/app/icon2.png  the mark, as it already shipped (98% of the tile
 *                   height, transparent), re-rendered with the supersample.
 *   - web/src/app/apple-icon.png  the mark on a full cream tile (as it already
 *                   shipped, but cream instead of navy #0F172A).
 *
 * `mobile/scripts/generate-assets.mjs` is a separate, Expo-side script and is
 * deliberately not touched here.
 *
 * Usage: `npm install` at the repo root, then `node scripts/logo-assets.mjs`
 * (sharp is a devDependency of the mobile workspace, hoisted to the root).
 * Commit the outputs.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// sharp is declared by the mobile workspace; npm hoists it to the root. Fall
// back to the workspace copy so the script runs from a partial install too.
const sharp = (() => {
  for (const candidate of ['sharp', join(repoRoot, 'mobile', 'node_modules', 'sharp')]) {
    try {
      return require(candidate);
    } catch {
      /* try the next one */
    }
  }
  throw new Error('sharp not found — run `npm install` at the repo root first');
})();

/** Brand cream (the logo card) and the "black" navy this change moves away from. */
const CREAM = '#F7F7F2';
const TRANSPARENT = null;

const ART = {
  mark: { file: join(repoRoot, 'logo', 'school-bus-mark.svg'), box: [0, 0, 303.75, 364] },
  lockup: { file: join(repoRoot, 'logo', 'school-bus-lockup.svg'), box: [0, 0, 1408, 768] },
};

/** Every copy of the traced artwork that carries the same stray paths. */
const VECTOR_COPIES = [
  ART.mark.file,
  ART.lockup.file,
  join(repoRoot, 'web', 'public', 'kidbus-mark.svg'),
  join(repoRoot, 'web', 'public', 'kidbus-logo.svg'),
  join(repoRoot, 'web', 'src', 'app', 'icon1.svg'),
];

/* ------------------------------------------------------------------ cleanup */

const isCream = (hex) => {
  if (!hex) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.min(r, g, b) > 190 && Math.max(r, g, b) - Math.min(r, g, b) < 50;
};
const pathsOf = (svg) => svg.match(/<path\s[\s\S]*?\/>/g) ?? [];
const fillOf = (tag) => (tag.match(/fill="(#[0-9A-Fa-f]{6})"/) ?? [])[1] ?? null;

/** Rasterise one path alone and return its coverage mask at 4x. */
async function maskOf(file, tag, box, k = 4) {
  const text = readFileSync(file, 'utf8');
  const group = (text.match(/<g[^>]*transform="([^"]+)"/) ?? [])[1];
  const inner = tag.replace(/fill="#[0-9A-Fa-f]{6}"/, 'fill="#000000"');
  const body = group ? `<g transform="${group}">${inner}</g>` : inner;
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${box[2]}" height="${box[3]}" viewBox="${box.join(' ')}">${body}</svg>`;
  const w = Math.round(box[2] * k);
  const h = Math.round(box[3] * k);
  const { data } = await sharp(Buffer.from(doc), { density: 72 * k })
    .resize(w, h, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(w * h);
  let area = 0;
  for (let p = 0; p < w * h; p++) {
    if (data[p * 4 + 3] > 110) {
      mask[p] = 1;
      area++;
    }
  }
  return { mask, area, w, h };
}

const dilate = (mask, w, h, r) => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -r; dy <= r && !hit; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          if (mask[yy * w + xx]) {
            hit = 1;
            break;
          }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
};

/**
 * The eight stray paths: cream, smaller than 120px² of artwork, more than half
 * of their area outside the silhouette and never further than 2px from it.
 * The silhouette is the union of the solid (non-cream) paths, which is what the
 * flecks are drawn on top of.
 */
async function findNoisePaths(file, box) {
  const svg = readFileSync(file, 'utf8');
  const tags = pathsOf(svg);
  const masks = [];
  for (const tag of tags) {
    const { mask, area, w, h } = await maskOf(file, tag, box);
    masks.push({ tag, fill: fillOf(tag), mask, area: area / 16, w, h });
  }
  const { w, h } = masks[0];
  const solid = new Uint8Array(w * h);
  for (const m of masks) {
    if (!m.fill || isCream(m.fill) || m.area <= 1000) continue;
    for (let p = 0; p < w * h; p++) if (m.mask[p]) solid[p] = 1;
  }
  const halo = dilate(solid, w, h, 8); // 2px at k=4
  const noise = [];
  for (const m of masks) {
    if (!isCream(m.fill) || m.area >= 120) continue;
    let inked = 0;
    let outside = 0;
    let far = 0;
    for (let p = 0; p < w * h; p++) {
      if (!m.mask[p]) continue;
      inked++;
      if (!solid[p]) {
        outside++;
        if (!halo[p]) far++;
      }
    }
    if (inked > 0 && outside / inked > 0.5 && far === 0) {
      noise.push(m.tag);
    }
  }
  return noise;
}

/** Drop the noise paths from every copy, keeping each file's own header/tail. */
async function cleanVectorCopies() {
  const noise = await findNoisePaths(ART.lockup.file, ART.lockup.box);
  if (noise.length === 0) {
    console.log('vector artwork: no stray paths left (already clean)');
    return;
  }
  // Signature = the path's opening geometry: the same 8 paths appear verbatim
  // in every copy, so this matches across files without hard-coding indices.
  const signatures = noise.map((tag) => tag.slice(0, 60));
  for (const file of VECTOR_COPIES) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const kept = lines.filter((line) => !signatures.some((sig) => line.includes(sig)));
    const removed = lines.length - kept.length;
    writeFileSync(file, kept.join('\n'));
    console.log(
      `vector artwork: ${file.replace(`${repoRoot}/`, '')} — dropped ${removed} stray path${removed === 1 ? '' : 's'}`,
    );
  }
}

/* ------------------------------------------------------------------ render */

/**
 * One tile: `canvas` square, `background` behind it, artwork scaled so that its
 * constrained edge covers `percent` of the canvas, centred.
 */
async function renderTile({ file, canvas, background, art, percent, constrain, ss = 4 }) {
  const [x0, y0, vw, vh] = art.box;
  const text = readFileSync(art.file, 'utf8');
  const group = (text.match(/<g[^>]*transform="([^"]+)"/) ?? [])[1];
  const inner = group
    ? `<g transform="${group}">${pathsOf(text).join('')}</g>`
    : pathsOf(text).join('');

  const target = (canvas * percent) / 100;
  const scale = constrain === 'width' ? target / vw : target / vh;
  const artW = vw * scale;
  const artH = vh * scale;
  const tx = (canvas - artW) / 2 - x0 * scale;
  const ty = (canvas - artH) / 2 - y0 * scale;

  const doc = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">`,
    background ? `<rect width="${canvas}" height="${canvas}" fill="${background}"/>` : '',
    `<g transform="translate(${tx} ${ty}) scale(${scale})">${inner}</g>`,
    '</svg>',
  ].join('');

  const png = await sharp(Buffer.from(doc), { density: 72 * ss })
    .resize(Math.round(canvas * ss), Math.round(canvas * ss), { fit: 'fill' })
    .resize(canvas, canvas, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(file, png);

  const margins = {
    horizontal: (((canvas - artW) / 2 / canvas) * 100).toFixed(1),
    vertical: (((canvas - artH) / 2 / canvas) * 100).toFixed(1),
  };
  console.log(
    `wrote ${file.replace(`${repoRoot}/`, '')} — ${canvas}², artwork ${artW.toFixed(0)}×${artH.toFixed(0)} ` +
      `(${((artW / canvas) * 100).toFixed(1)}%×${((artH / canvas) * 100).toFixed(1)}%), margins ${margins.horizontal}% / ${margins.vertical}%`,
  );
}

const TILES = [
  // Home-screen icon: the mark alone, so it stays bold and legible at 48-192px.
  {
    file: join(repoRoot, 'mobile', 'assets', 'icon.png'),
    canvas: 1024,
    background: CREAM,
    art: ART.mark,
    percent: 76,
    constrain: 'height',
  },
  // Adaptive foreground: transparent, clear of the 66dp circle (61.1%).
  // 59% of 1024 = 604px tall, so the pin tip and head keep ~11px (≈1.2dp of the
  // 108dp canvas) of clearance under the mask circle at top and bottom.
  {
    file: join(repoRoot, 'mobile', 'assets', 'adaptive-icon.png'),
    canvas: 1024,
    background: TRANSPARENT,
    art: ART.mark,
    percent: 59,
    constrain: 'height',
  },
  // Splash: the lockup on cream, so the card blends into the canvas.
  {
    file: join(repoRoot, 'mobile', 'assets', 'splash.png'),
    canvas: 1024,
    background: CREAM,
    art: ART.lockup,
    percent: 70,
    constrain: 'width',
  },
  // Browser bookmarks (transparent — the browser paints behind it).
  {
    file: join(repoRoot, 'mobile', 'assets', 'favicon.png'),
    canvas: 48,
    background: TRANSPARENT,
    art: ART.mark,
    percent: 75,
    constrain: 'height',
  },
  // Browser icon fallback for engines without SVG favicons: the mark, as it
  // already shipped, just rendered smoothly instead of at 1x.
  {
    file: join(repoRoot, 'web', 'src', 'app', 'icon2.png'),
    canvas: 256,
    background: TRANSPARENT,
    art: ART.mark,
    percent: 98,
    constrain: 'height',
  },
  // iOS home screen: the mark, as it already shipped, now on the brand cream
  // #F7F7F2 instead of navy #0F172A.
  {
    file: join(repoRoot, 'web', 'src', 'app', 'apple-icon.png'),
    canvas: 180,
    background: CREAM,
    art: ART.mark,
    percent: 98,
    constrain: 'height',
  },
];

async function main() {
  await cleanVectorCopies();
  for (const tile of TILES) {
    await renderTile(tile);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
