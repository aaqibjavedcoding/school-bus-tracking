#!/usr/bin/env python3
"""Cut the generated bus master out of its drawn "transparent" checkerboard
and export the three React Native marker densities.

The generator flattened a grey/white checkerboard pattern into the PNG
instead of writing a real alpha channel. Every background pixel is neutral
(R ~= G ~= B) and bright (>= ~165); every bus pixel is either saturated
(the yellow body, pale roof stripe) or dark (charcoal outline, tinted
windows far below 165). So the key is colour-neutral-and-bright => backdrop,
which survives the 1 px blend lines between checker squares as well.

Exports bus-marker.png 26x42 (@1x), bus-marker@2x.png 52x84,
bus-marker@3x.png 78x126 into mobile/assets/ — the box BusMarkerGraphic
pins in bus-marker-invariants.spec.ts.
"""

import numpy as np
from PIL import Image, ImageFilter

MASTER = "mobile/assets/gen/bus-master.png"
OUT = "mobile/assets/bus-marker{}.png"
# BusMarkerGraphic pins BUS_MARKER_WIDTH x BUS_MARKER_HEIGHT.
BOX_W, BOX_H = 26, 42


def main() -> None:
    img = Image.open(MASTER).convert("RGB")
    rgb = np.asarray(img).astype(np.int16)
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    mean = rgb.mean(axis=2)

    # Neutral AND bright => checkerboard backdrop (white squares, grey
    # squares, and the blend lines where they meet).
    backdrop = (mx - mn <= 10) & (mean >= 165)
    alpha = np.where(backdrop, 0, 255).astype(np.uint8)

    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    cut = Image.fromarray(rgba, "RGBA")

    # Feather the cut edge a hair so the high-res master downsamples to a
    # clean anti-aliased outline instead of a hard keyline.
    cut.putalpha(cut.getchannel("A").filter(ImageFilter.GaussianBlur(0.8)))

    bbox = cut.getchannel("A").getbbox()
    if bbox is None:
        raise SystemExit("cutout is empty — keying thresholds ate the bus")
    cut = cut.crop(bbox)

    # Letter-box onto a canvas with exactly the marker aspect, bus centred.
    target_ratio = BOX_W / BOX_H
    w, h = cut.size
    pad = round(h * 0.015)  # keep the mirrors off the box edge
    w, h = w + 2 * pad, h + 2 * pad
    if w / h < target_ratio:
        w = round(h * target_ratio)
    else:
        h = round(w / target_ratio)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(cut, ((w - cut.width) // 2, (h - cut.height) // 2), cut)

    # One Lanczos resample per density, always from the full-res master.
    for d in range(1, 4):
        size = (BOX_W * d, BOX_H * d)
        scaled = canvas.resize(size, Image.LANCZOS)
        scaled.save(OUT.format("" if d == 1 else f"@{d}x"), optimize=True)
        print("wrote", OUT.format("" if d == 1 else f"@{d}x"), size)


if __name__ == "__main__":
    main()
