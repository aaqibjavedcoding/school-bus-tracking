#!/usr/bin/env node
/**
 * Rasterise the mobile bus-marker PNGs FROM THE SHARED SVG.
 *
 * ### The single source of truth
 *
 * The bus artwork is defined exactly once, in
 * `@school-bus-tracking/map-assets` (`BUS_BODY_SVG`). The web map inlines that
 * same markup as SVG; this script turns it into the three React Native density
 * PNGs. There is no separate bus master any more — the old 1.6 MB
 * `mobile/assets/gen/bus-master.png` (an AI-generated raster that had drifted
 * away from the web marker) is gone, and with it the "two buses that claim to be
 * one" problem. Edit the bus in `packages/map-assets/src/index.ts`, run this,
 * and web + mobile move together.
 *
 * ### Why the body only (no shadow)
 *
 * `BUS_BODY_SVG` is deliberately the rotating body WITHOUT the ground shadow:
 * the mobile marker view rotates this PNG to the heading, and a baked-in shadow
 * would spin with the bus. The static ground shadow is drawn by the marker
 * component instead (`BusMarkerGraphic`), outside the rotating view.
 *
 * ### Output
 *
 * `mobile/assets/bus-marker.png` 26×42 (@1x), `bus-marker@2x.png` 52×84,
 * `bus-marker@3x.png` 78×126 — RGBA, the exact box `BusMarkerGraphic` pins in
 * `bus-marker-invariants.spec.ts`. One high-resolution master is rendered from
 * the SVG once and Lanczos-downsampled per density, so every file is the same
 * artwork at a crisp integer size (no runtime resampling on cheap phones).
 *
 * Usage: from the repo root, `npm install` (builds the package and installs
 * sharp), then `node scripts/make-bus-marker.mjs`. Commit the three PNGs.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BUS_BODY_SVG, BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT } from '@school-bus-tracking/map-assets';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const OUT = (suffix) => join(repoRoot, 'mobile', 'assets', `bus-marker${suffix}.png`);

const BOX_W = BUS_MARKER_WIDTH;
const BOX_H = BUS_MARKER_HEIGHT;
/** Oversample factor for the master render, so the @3x downsample is clean. */
const MASTER_SCALE = 12;

async function main() {
  // One high-res master straight from the shared SVG. `density` is DPI: the SVG
  // declares a 26 px width, so 72 × MASTER_SCALE renders it at BOX_W × MASTER_SCALE.
  const master = await sharp(Buffer.from(BUS_BODY_SVG), { density: 72 * MASTER_SCALE })
    .resize(BOX_W * MASTER_SCALE, BOX_H * MASTER_SCALE, { fit: 'fill' })
    .png()
    .toBuffer();

  for (let d = 1; d <= 3; d += 1) {
    const size = [BOX_W * d, BOX_H * d];
    const suffix = d === 1 ? '' : `@${d}x`;
    await sharp(master)
      .resize(size[0], size[1], { fit: 'fill', kernel: 'lanczos3' })
      .png({ compressionLevel: 9, palette: false })
      .toFile(OUT(suffix));
    // Verify the written IHDR matches what the invariants spec pins.
    const meta = await sharp(OUT(suffix)).metadata();
    if (meta.width !== size[0] || meta.height !== size[1] || !meta.hasAlpha) {
      throw new Error(
        `bus-marker${suffix}.png is ${meta.width}×${meta.height} alpha=${meta.hasAlpha}, expected ${size[0]}×${size[1]} RGBA`,
      );
    }
    console.log('wrote', OUT(suffix), `${size[0]}×${size[1]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
