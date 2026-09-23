#!/usr/bin/env python3
"""Exports platform-shaped versions of the rendered square masters.

  videos/9x16/<id>.mp4   1080x1920  Reels, Stories, YouTube Shorts   (all films by default)
  videos/16x9/<id>.mp4   1920x1080  LinkedIn desktop, YouTube, website (the two hero films by default)

The square master sits in the middle at its native size -- so the on-screen text keeps
exactly the same physical size it has in the 1:1 cut -- and a blurred, blown-up copy of the
same frame fills the rest of the canvas. No letterbox bars, no cropping, no second pass over
the motion graphics, audio copied bit-for-bit.

Usage:
  python3 export_versions.py                 # all verticals + the hero landscapes
  python3 export_versions.py --all           # verticals AND landscapes for every film
  python3 export_versions.py K1 K3           # only these films (both orientations)
  python3 export_versions.py --vertical-only # skip landscape entirely
"""
from __future__ import annotations

import glob
import os
import subprocess
import sys

import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO_DIR = os.path.join(ROOT, "videos")
FF = imageio_ffmpeg.get_ffmpeg_exe()

V_CRF = "27"          # verticals: soft motion graphics, 27 is visually transparent here
H_CRF = "26"
# landscape cut is a "nice to have" for most films, so only the hero films ship with one
HERO = ("K6", "K11")

VERTICAL = (
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
    "boxblur=32:2,eq=brightness=-0.08[bg];"
    "[0:v]scale=1080:1080[fg];[bg][fg]overlay=0:(H-h)/2"
)
HORIZONTAL = (
    "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,"
    "boxblur=34:2,eq=brightness=-0.08[bg];"
    "[0:v]scale=1080:1080[fg];[bg][fg]overlay=(W-w)/2:0"
)


def export(src: str, out_dir: str, filtergraph: str, crf: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, os.path.basename(src))
    subprocess.run(
        [FF, "-y", "-v", "error", "-i", src, "-filter_complex", filtergraph,
         "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p",
         "-c:a", "copy", "-movflags", "+faststart", out],
        check=True,
    )
    print(f"  {os.path.relpath(out, ROOT)}  ({os.path.getsize(out)/1e6:.1f} MB)")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    srcs = sorted(glob.glob(os.path.join(VIDEO_DIR, "*.mp4")))
    if args:
        srcs = [s for s in srcs if any(os.path.basename(s).startswith(p) for p in args)]

    if "--vertical-only" not in flags:
        landscape = srcs if "--all" in flags else [
            s for s in srcs if os.path.basename(s).startswith(HERO)
        ]
    else:
        landscape = []

    for s in srcs:
        print(f"[9:16] {os.path.basename(s)}")
        export(s, os.path.join(VIDEO_DIR, "9x16"), VERTICAL, V_CRF)
    for s in landscape:
        print(f"[16:9] {os.path.basename(s)}")
        export(s, os.path.join(VIDEO_DIR, "16x9"), HORIZONTAL, H_CRF)


if __name__ == "__main__":
    main()
