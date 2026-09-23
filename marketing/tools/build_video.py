#!/usr/bin/env python3
"""KidBus promo video renderer.

Usage:
  python3 build_video.py                 # render every video in spec.py
  python3 build_video.py --only K1 K3    # render a subset (prefix match)
  python3 build_video.py --only K1 --preview   # only dump preview frames (fast)
  python3 build_video.py --no-audio      # video only (skips VO mix)

Output per video (1080x1080, 30 fps, H.264 + AAC):
  videos/<id>.mp4
  social/srt/<id>.srt
  social/thumbs/<id>_1.jpg ... _3.jpg
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
import imageio_ffmpeg

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec import ACCENTS, BRAND, VIDEOS, variant_videos  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI_DIR = os.path.join(ROOT, "assets", "ai")
BRAND_DIR = os.path.join(ROOT, "assets", "brand")
FONT_DIR = os.path.join(ROOT, "assets", "fonts")
VO_DIR = os.path.join(ROOT, "voiceover")
VIDEO_DIR = os.path.join(ROOT, "videos")
SRT_DIR = os.path.join(ROOT, "social", "srt")
THUMB_DIR = os.path.join(ROOT, "social", "thumbs")
TMP_DIR = os.path.join(ROOT, "tmp")

W = H = 1080
FPS = 30
SR = 48000
CRF = "23"           # master quality: 23 keeps a 30 s film ≈ 3–5 MB with no visible loss
VARIANT_CRF = "26"   # re-narrated variants: ~25% smaller, no visible difference on these plates
THUMB_Q = 84
M = 64
LEAD = 0.45          # silence before narration
DISSOLVE = 0.38      # scene crossfade seconds
FF = imageio_ffmpeg.get_ffmpeg_exe()

NAVY = (15, 23, 42)
NAVY_DEEP = (6, 11, 25)
GOLD = (245, 166, 35)
WHITE = (255, 255, 255)
SLATE = (203, 213, 225)

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    key = (weight, size)
    if key not in _FONT_CACHE:
        path = os.path.join(FONT_DIR, f"Poppins-{weight}.ttf")
        _FONT_CACHE[key] = ImageFont.truetype(path, size)
    return _FONT_CACHE[key]


def ease_out(u: float) -> float:
    u = max(0.0, min(1.0, u))
    return 1 - (1 - u) ** 3


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------
def new_layer():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def to_element(im: Image.Image, t0: float = 0.0, dur: float = 0.45, slide: int = 26, key: str = "") -> dict:
    """Crop a full canvas RGBA layer to its bbox and return an animatable element."""
    bbox = im.split()[3].getbbox()
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    cropped = im.crop(bbox)
    return {
        "rgb": cropped.convert("RGB"),
        "mask": cropped.split()[3],
        "x": x0,
        "y": y0,
        "t0": t0,
        "dur": dur,
        "slide": slide,
        "key": key or f"el{id(im)}",
    }


def draw_text(d: ImageDraw.ImageDraw, xy, text, f, fill, shadow=True, spacing=0):
    x, y = xy
    if shadow:
        draw_text_raw(d, (x, y + 3), text, f, (0, 0, 0, 130), spacing)
    draw_text_raw(d, (x, y), text, f, fill, spacing)


def draw_text_raw(d, xy, text, f, fill, spacing=0):
    x, y = xy
    if spacing == 0:
        d.text((x, y), text, font=f, fill=fill)
        return
    cx = x
    for ch in text:
        d.text((cx, y), ch, font=f, fill=fill)
        cx += f.getlength(ch) + spacing


def wrap(text: str, f: ImageFont.FreeTypeFont, maxw: float) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if f.getlength(trial) <= maxw or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def pill_layer(text, f, text_fill, fill, border, pad_x=30, height=66, radius=None, glyph=False):
    """Returns (layer, draw, width, height)."""
    radius = height // 2 if radius is None else radius
    tw = f.getlength(text)
    gx = 46 if glyph else 0
    width = int(tw + pad_x * 2 + gx)
    im = Image.new("RGBA", (width + 6, height + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([3, 3, width + 2, height + 2], radius=radius, fill=fill, outline=border, width=2)
    x = 3 + pad_x
    if glyph:
        draw_bus_glyph(d, x, 3 + (height - 30) // 2, 30, text_fill)
        x += gx
    d.text((x, 3 + (height - f.size) / 2 - f.size * 0.12), text, font=f, fill=text_fill)
    return im


def draw_bus_glyph(d: ImageDraw.ImageDraw, x, y, h, color):
    w = h * 1.65
    d.rounded_rectangle([x, y + h * 0.12, x + w, y + h * 0.80], radius=h * 0.22, fill=color)
    d.rounded_rectangle([x + w * 0.12, y + h * 0.26, x + w * 0.44, y + h * 0.50], radius=h * 0.06, fill=(15, 23, 42))
    d.rounded_rectangle([x + w * 0.52, y + h * 0.26, x + w * 0.88, y + h * 0.50], radius=h * 0.06, fill=(15, 23, 42))
    d.ellipse([x + w * 0.16, y + h * 0.66, x + w * 0.36, y + h * 0.94], fill=color)
    d.ellipse([x + w * 0.64, y + h * 0.66, x + w * 0.84, y + h * 0.94], fill=color)


# --------------------------------------------------------------------------
# chrome (kicker / watermark / caption band / progress)
# --------------------------------------------------------------------------
def build_kicker() -> dict:
    im, d = new_layer()
    f = font("Bold", 34)
    text = BRAND["product"].upper()
    tw = f.getlength(text)
    w = int(tw + 30 * 2 + 46)
    y = 58
    d.rounded_rectangle([M, y, M + w, y + 60], radius=30, fill=GOLD + (255,))
    draw_bus_glyph(d, M + 28, y + 15, 30, NAVY + (255,))
    d.text((M + 30 + 46, y + 16), text, font=f, fill=NAVY + (255,))
    return to_element(im, t0=0.0, dur=0.5, slide=0, key="kicker")


def build_watermark() -> dict:
    im, d = new_layer()
    f = font("SemiBold", 30)
    text = f"by {BRAND['company']}"
    tw = f.getlength(text)
    x = W - M - tw
    draw_text(d, (x, 74), text, f, (255, 255, 255, 205))
    return to_element(im, t0=0.0, dur=0.5, slide=0, key="wm")


def build_caption_band(title: str, body: str, accent: tuple, wide: bool = False) -> dict:
    accent_dark, accent_light = accent
    im, d = new_layer()
    x0, x1 = 48, W - 48
    y0, y1 = 830, 1030
    d.rounded_rectangle([x0, y0, x1, y1], radius=30, fill=(8, 13, 26, 228), outline=accent_dark + (120,), width=2)
    d.rounded_rectangle([x0 + 34, y0 + 30, x0 + 42, y0 + 78], radius=4, fill=accent_light + (255,))

    ft = font("SemiBold", 30)
    draw_text(d, (x0 + 62, y0 + 32), title.upper(), ft, accent_light + (255,), spacing=2)

    maxw = x1 - (x0 + 62) - 40
    size = 48
    while size > 32:
        fb = font("Bold", size)
        lines = wrap(body, fb, maxw)
        if len(lines) <= 2:
            break
        size -= 2
    fb = font("Bold", size)
    lines = wrap(body, fb, maxw)[:2]
    lh = size + 10
    y = y0 + 78
    for ln in lines:
        draw_text(d, (x0 + 62, y), ln, fb, WHITE + (255,))
        y += lh
    return to_element(im, t0=0.22, dur=0.55, slide=34, key="cap")


def build_headline(text: str, size: int = 84) -> dict:
    im, d = new_layer()
    f = font("ExtraBold", size)
    lines = wrap(text, f, W - 2 * M + 10)
    y = 168
    for ln in lines:
        draw_text(d, (M, y), ln, f, WHITE + (255,))
        y += int(size * 1.16)
    return to_element(im, t0=0.06, dur=0.5, slide=30, key="hl")


def build_chips(items: list[str], accent: tuple) -> list[dict]:
    accent_dark, accent_light = accent
    f = font("SemiBold", 34)
    els = []
    x, y = M, 0  # y filled after headline
    return els, f  # placeholder (real work in layout_chips)


def layout_chips(items: list[str], accent: tuple, y0: int) -> list[tuple[dict, int]]:
    accent_dark, accent_light = accent
    f = font("SemiBold", 34)
    out, x, y = [], M, y0
    for i, text in enumerate(items):
        w = int(f.getlength(text) + 60)
        if x + w > W - M:
            x = M
            y += 66 + 16
        im = Image.new("RGBA", (w, 66), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, w - 1, 65], radius=33, fill=(8, 13, 26, 208), outline=accent_dark + (215,), width=2)
        d.text(((w - f.getlength(text)) / 2, 14), text, font=f, fill=accent_light + (255,))
        out.append(({"rgb": im.convert("RGB"), "mask": im.split()[3], "x": x, "y": y,
                     "t0": 0.42 + 0.10 * i, "dur": 0.4, "slide": 18, "key": f"chip{i}"}, y))
        x += w + 16
    return out


def headline_height(text: str, size: int = 84) -> int:
    f = font("ExtraBold", size)
    return int(len(wrap(text, f, W - 2 * M + 10)) * size * 1.16)


# --------------------------------------------------------------------------
# backgrounds
# --------------------------------------------------------------------------
def plate(name: str) -> str:
    """Resolve a scene plate by name, preferring the .jpg master (.png also works)."""
    for ext in (".jpg", ".png"):
        p = os.path.join(AI_DIR, name + ext)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f"no scene plate for {name!r} in {AI_DIR}")


def load_base(path: str, focus=(0.5, 0.5), base_px: int = 1400) -> Image.Image:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w != h:
        side = min(w, h)
        im = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    im = im.resize((base_px, base_px), Image.LANCZOS)
    im = ImageEnhance.Color(im).enhance(1.06)
    im = ImageEnhance.Brightness(im).enhance(0.94)
    return im, focus


def gradient_bg(base_px: int = 1400) -> Image.Image:
    y = np.linspace(0, 1, base_px)[:, None]
    top = np.array(NAVY_DEEP, dtype=np.float64)
    bot = np.array(NAVY, dtype=np.float64)
    img = top[None, None, :] * (1 - y[:, :, None]) + bot[None, None, :] * y[:, :, None]
    img = np.repeat(img, base_px, axis=1)
    yy, xx = np.mgrid[0:base_px, 0:base_px]
    r = np.sqrt(((xx - base_px * 0.5) / base_px) ** 2 + ((yy - base_px * 0.38) / base_px) ** 2)
    glow = np.clip(1 - r * 2.6, 0, 1) ** 2 * 0.28
    img = img + glow[:, :, None] * np.array(GOLD, dtype=np.float64)[None, None, :]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def kb_crop(base: Image.Image, focus, u: float, motion: str) -> Image.Image:
    bw = base.size[0]
    span = bw - W
    if motion == "zoom_in":
        cw = bw - span * ease_out(u)
    elif motion == "zoom_out":
        cw = W + span * (1 - ease_out(u))
    elif motion in ("pan_left", "pan_right"):
        cw = W + span * 0.45
    else:
        cw = bw
    cw = int(round(min(bw, max(W, cw))))
    ch = cw
    if motion == "pan_left":
        fx = 1 - ease_out(u)
    elif motion == "pan_right":
        fx = ease_out(u)
    else:
        fx = 0.5 + (focus[0] - 0.5) * 0.6
    fy = 0.5 + (focus[1] - 0.5) * 0.6
    x = int(round((bw - cw) * fx))
    y = int(round((bw - ch) * fy))
    crop = base.crop((x, y, x + cw, y + ch))
    if cw != W:
        crop = crop.resize((W, H), Image.LANCZOS)
    return crop


def scrim() -> tuple[Image.Image, Image.Image]:
    """Static darkening: top gradient (for headline) + bottom (for caption band)."""
    top = np.clip(1 - np.linspace(0, 1, H)[:, None] / 0.66, 0, 1) ** 0.95
    bottom = np.clip((np.linspace(0, 1, H)[:, None] - 0.55) / 0.45, 0, 1) ** 1.30
    col = np.maximum(top * 0.88, bottom * 0.88)          # (H, 1)
    a = np.repeat(col, W, axis=1)                        # (H, W)
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    a = np.clip(a + np.clip((r - 0.85), 0, 1) * 0.5, 0, 1)
    layer = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), mode="L")
    return Image.new("RGB", (W, H), (0, 0, 0)), layer


SCRIM_RGB, SCRIM_MASK = scrim()


# --------------------------------------------------------------------------
# logo mark for the end card
# --------------------------------------------------------------------------
def load_mark(size: int = 260) -> Image.Image:
    path = plate("08-logo-mark")
    im = Image.open(path).convert("RGB")
    arr = np.asarray(im).astype(np.int16)
    bg = arr[4, 4]
    dist = np.abs(arr - bg[None, None, :]).sum(axis=2)
    keep = (dist > 60).astype(np.uint8) * 255
    mask = Image.fromarray(keep, mode="L").filter(ImageFilter.GaussianBlur(1.2))
    bbox = mask.getbbox()
    im = im.crop(bbox)
    mask = mask.crop(bbox)
    w, h = im.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), tuple(int(v) for v in bg))
    cmask = Image.new("L", (side, side), 0)
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    cmask.paste(mask, ((side - w) // 2, (side - h) // 2))
    canvas = canvas.resize((size, size), Image.LANCZOS)
    cmask = cmask.resize((size, size), Image.LANCZOS)
    return canvas, cmask


# --------------------------------------------------------------------------
# scene preparation
# --------------------------------------------------------------------------
def prep_scene(sc: dict, mark_cache: dict) -> dict:
    if sc.get("kind") == "cta":
        return prep_cta(mark_cache)
    base, focus = load_base(plate(sc["img"]), sc.get("focus", (0.5, 0.5)))
    accent = ACCENTS[sc["accent"]]
    els = [build_kicker(), build_watermark()]
    hl = build_headline(sc["hl"])
    els.append(hl)
    hl_bottom = 168 + headline_height(sc["hl"])
    chips_y = hl_bottom + 30
    for el, _ in layout_chips(sc.get("chips", []), accent, chips_y):
        els.append(el)
    cap = build_caption_band(sc["cap"][0], sc["cap"][1], accent)
    if cap:
        els.append(cap)
    return {
        "kind": "image",
        "base": base,
        "focus": focus,
        "motion": sc.get("motion", "zoom_in"),
        "els": [e for e in els if e],
        "accent": accent,
        "flash": sc.get("flash"),
    }


def prep_cta(mark_cache: dict) -> dict:
    if "mark" not in mark_cache:
        mark_cache["mark"] = load_mark(250)
    mark, mmask = mark_cache["mark"]
    im, d = new_layer()
    im.paste(mark, ((W - 250) // 2, 96), mmask)

    f = font("ExtraBold", 124)
    word = BRAND["product"]
    tw = f.getlength(word) + 26
    x = (W - tw) / 2
    draw_text(d, (x, 372), word, f, WHITE + (255,))
    d.ellipse([x + tw - 16, 372 + 92, x + tw + 6, 372 + 114], fill=GOLD + (255,))

    f2 = font("Medium", 40)
    t2 = BRAND["tagline"]
    draw_text(d, ((W - f2.getlength(t2)) / 2, 528), t2, f2, SLATE + (255,))
    els = [to_element(im, t0=0.10, dur=0.6, slide=22, key="mark")]

    # URL pill
    f3 = font("ExtraBold", 46)
    url = BRAND["company"]
    w = int(f3.getlength(url) + 76)
    im2, d2 = new_layer()
    x0 = (W - w) / 2
    d2.rounded_rectangle([x0, 608, x0 + w, 608 + 84], radius=42, fill=GOLD + (255,))
    d2.text(((W - f3.getlength(url)) / 2, 608 + 18), url, font=f3, fill=NAVY + (255,))
    els.append(to_element(im2, t0=0.30, dur=0.5, slide=26, key="url"))

    # offer chip
    f4 = font("SemiBold", 38)
    offer = BRAND["cta"]
    w4 = int(f4.getlength(offer) + 70)
    im3, d3 = new_layer()
    g = ACCENTS["green"]
    x4 = (W - w4) / 2
    d3.rounded_rectangle([x4, 716, x4 + w4, 716 + 68], radius=34, fill=g[0] + (60,), outline=g[0] + (190,), width=2)
    d3.text(((W - f4.getlength(offer)) / 2, 716 + 14), offer, font=f4, fill=g[1] + (255,))
    els.append(to_element(im3, t0=0.46, dur=0.5, slide=26, key="offer"))

    cap = build_caption_band("GET STARTED TODAY", f"{BRAND['email']}   •   {BRAND['company']}", ACCENTS["gold"])
    if cap:
        els.append(cap)
    return {"kind": "cta", "base": gradient_bg(), "focus": (0.5, 0.5), "motion": "zoom_out", "els": els, "accent": ACCENTS["gold"]}


# --------------------------------------------------------------------------
# frame rendering
# --------------------------------------------------------------------------
def render_scene_frame(p: dict, lt: float, u: float, global_t: float, total: float, accent_override=None) -> Image.Image:
    fr = kb_crop(p["base"], p["focus"], u, p["motion"]).convert("RGB")
    fr.paste(SCRIM_RGB, (0, 0), SCRIM_MASK)
    fl = p.get("flash")
    if fl:
        t0, dur_fl, period = fl
        if t0 <= lt <= t0 + dur_fl:
            ph = ((lt - t0) % period) / period
            a = 0.30 * (1 - ph) ** 1.4
            fr = Image.blend(fr, Image.new("RGB", (W, H), (196, 26, 26)), a)
    for el in p["els"]:
        a = ease_out((lt - el["t0"]) / el["dur"]) if el["dur"] > 0 else 1.0
        if a <= 0.01:
            continue
        dy = int(round((1 - a) * el["slide"]))
        mask = el["mask"] if a >= 0.99 else el["mask"].point(_alpha_lut(a))
        fr.paste(el["rgb"], (el["x"], el["y"] + dy), mask)
    # progress bar
    accent = accent_override or p["accent"][1]
    d = ImageDraw.Draw(fr, "RGBA")
    x0, x1, yb = 48, W - 48, 1048
    d.rounded_rectangle([x0, yb, x1, yb + 8], radius=4, fill=(255, 255, 255, 60))
    prog = max(0.0, min(1.0, global_t / total))
    if prog > 0.004:
        d.rounded_rectangle([x0, yb, x0 + max(10, (x1 - x0) * prog), yb + 8], radius=4, fill=accent + (255,))
    return fr


_ALPHA_CACHE: dict[int, list[int]] = {}


def _alpha_lut(a: float) -> list[int]:
    q = int(a * 255)
    if q not in _ALPHA_CACHE:
        _ALPHA_CACHE[q] = [int(v * q / 255) for v in range(256)]
    return _ALPHA_CACHE[q]


# --------------------------------------------------------------------------
# audio
# --------------------------------------------------------------------------
def decode_vo(path: str):
    """Returns (samples, tempo_applied)."""
    raw = subprocess.run(
        [FF, "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def decode_vo_tempo(path: str, tempo: float):
    tempo = max(0.85, min(1.18, tempo))
    raw = subprocess.run(
        [FF, "-v", "error", "-i", path, "-filter:a", f"atempo={tempo:.4f}",
         "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def whoosh(dur=0.5, vol=0.055, seed=1):
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n)
    k1 = np.hanning(25)
    k1 /= k1.sum()
    k2 = np.hanning(451)
    k2 /= k2.sum()
    band = np.convolve(noise, k2, "same") - np.convolve(noise, k1, "same")
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.6
    return band / (np.max(np.abs(band)) + 1e-9) * env * vol


def ding(vol=0.085, f=1046.5, dur=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) * np.exp(-4.2 * t) + 0.45 * np.sin(2 * np.pi * f * 1.5 * t) * np.exp(-6.5 * t)
    return y / (np.max(np.abs(y)) + 1e-9) * vol


def sting(vol=0.10):
    def tone(dur, f):
        n = int(dur * SR)
        t = np.arange(n) / SR
        return np.sin(2 * np.pi * f * t) * np.exp(-3.2 * t)
    a = tone(0.30, 523.25) * vol
    b = tone(0.75, 783.99) * vol
    out = np.zeros(int(1.05 * SR))
    out[: len(a)] += a
    out[int(0.16 * SR): int(0.16 * SR) + len(b)] += b
    return out


def add_at(buf: np.ndarray, x: np.ndarray, at: float):
    i = int(at * SR)
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), len(buf) - i)
    if n > 0:
        buf[i: i + n] += x[:n]


def build_audio(video: dict, timeline: list[dict], vo_path: str):
    T = video["duration"]
    n = int(T * SR)
    buflen = n + SR
    vo = decode_vo(vo_path)
    speech = len(vo) / SR
    budget = T - LEAD - 0.55
    tempo = 1.0
    if speech > budget:
        tempo = min(1.16, speech / max(0.5, budget))
        vo = decode_vo_tempo(vo_path, tempo)
        speech = len(vo) / SR

    mix = np.zeros(buflen)
    add_at(mix, vo, LEAD)

    for i, sc in enumerate(timeline):
        if i == 0:
            continue
        if sc.get("kind") == "cta":
            add_at(mix, sting(), sc["start"])
        else:
            add_at(mix, whoosh(seed=i * 7 + 3), sc["start"] - 0.10)
        if sc.get("ding"):
            add_at(mix, ding(), sc["start"] + 0.12)

    peak = np.max(np.abs(mix)) + 1e-9
    mix = mix / peak * 0.94
    stereo = np.stack([mix, mix], axis=1)
    pcm = np.clip(stereo * 32767.0, -32768, 32767).astype("<i2")
    return pcm, tempo


def write_wav(path: str, pcm: np.ndarray):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())


# --------------------------------------------------------------------------
# main build
# --------------------------------------------------------------------------
def srt_time(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build(video: dict, with_audio=True, preview=False, outdir: str | None = None):
    vid = video["id"]
    T = video["duration"]
    scenes = video["scenes"]
    total_w = sum(s.get("w", 8) for s in scenes)
    avail = T
    durs = [avail * s.get("w", 8) / total_w for s in scenes]
    # make sure the end card holds long enough
    if durs[-1] < 2.2:
        shift = 2.2 - durs[-1]
        durs[-1] = 2.2
        for i in range(len(durs) - 1):
            durs[i] -= shift * durs[i] / sum(durs[:-1])

    starts, acc = [], 0.0
    for dd in durs:
        starts.append(acc)
        acc += dd
    timeline = []
    for sc, st, dd in zip(scenes, starts, durs):
        timeline.append({"start": st, "dur": dd, "kind": sc.get("kind", "image"),
                         "ding": sc.get("ding", False),
                         "title": sc.get("cap", ("KidBus", ""))[0] if sc.get("kind") != "cta" else "GET STARTED TODAY",
                         "body": sc.get("cap", ("", ""))[1] if sc.get("kind") != "cta" else f"{BRAND['email']} • {BRAND['company']}"})

    mark_cache: dict = {}
    preps = [prep_scene(sc, mark_cache) for sc in scenes]

    nframes = int(round(T * FPS))
    os.makedirs(TMP_DIR, exist_ok=True)
    silent = os.path.join(TMP_DIR, f"{vid}.silent.mp4")

    def frame_at(t: float) -> Image.Image:
        # find current scene
        idx = 0
        for i, st in enumerate(starts):
            if t >= st - 1e-9:
                idx = i
        sc = scenes[idx]
        p = preps[idx]
        lt = t - starts[idx]
        u = min(1.0, max(0.0, lt / max(0.1, durs[idx])))
        fr = render_scene_frame(p, lt, u, t, T)
        # crossfade from previous scene
        if idx > 0 and lt < DISSOLVE:
            a = ease_out(lt / DISSOLVE)
            prev = preps[idx - 1]
            lt_prev = durs[idx - 1] + lt
            u_prev = 1.0
            fr_prev = render_scene_frame(prev, lt_prev, u_prev, t, T)
            fr = Image.blend(fr_prev, fr, a)
        return fr

    if preview:
        os.makedirs(os.path.join(ROOT, "tmp", "preview"), exist_ok=True)
        marks = [0.8 * durs[0], starts[1] + 0.35 * durs[1], T - 0.6]
        for i, tm in enumerate(marks):
            frame_at(tm).save(os.path.join(ROOT, "tmp", "preview", f"{vid}_{i+1}.jpg"), quality=90)
        print(f"[preview] {vid}: frames written")
        return

    writer = imageio_ffmpeg.write_frames(
        silent, (W, H), fps=FPS, codec="libx264", pix_fmt_in="rgb24", pix_fmt_out="yuv420p",
        quality=None, macro_block_size=8, ffmpeg_log_level="error",
        output_params=["-crf", CRF, "-preset", "medium", "-movflags", "+faststart"],
    )
    writer.send(None)
    for i in range(nframes):
        writer.send(np.asarray(frame_at(i / FPS), dtype=np.uint8))
    writer.close()

    video_dir = outdir or VIDEO_DIR
    out = os.path.join(video_dir, f"{vid}.mp4")
    os.makedirs(video_dir, exist_ok=True)
    if with_audio:
        vo_path = os.path.join(VO_DIR, f"{vid}.mp3")
        pcm, tempo = build_audio(video, timeline, vo_path)
        wav = os.path.join(TMP_DIR, f"{vid}.wav")
        write_wav(wav, pcm)
        subprocess.run([FF, "-y", "-v", "error", "-i", silent, "-i", wav,
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", str(SR),
                        "-movflags", "+faststart", "-shortest", out], check=True)
        os.remove(wav)
        print(f"[video] {out}  (voice tempo x{tempo:.3f})")
    else:
        subprocess.run([FF, "-y", "-v", "error", "-i", silent, "-c", "copy", out], check=True)
        print(f"[video] {out} (no audio)")

    # SRT
    os.makedirs(SRT_DIR, exist_ok=True)
    with open(os.path.join(SRT_DIR, f"{vid}.srt"), "w", encoding="utf-8") as fh:
        for i, sc in enumerate(timeline, 1):
            fh.write(f"{i}\n{srt_time(sc['start'])} --> {srt_time(sc['start'] + sc['dur'])}\n"
                     f"{sc['title']}\n{sc['body']}\n\n")

    # thumbnails
    os.makedirs(THUMB_DIR, exist_ok=True)
    marks = [0.85 * durs[0], starts[1] + 0.45 * durs[1], T - 0.75]
    for i, tm in enumerate(marks):
        frame_at(tm).save(os.path.join(THUMB_DIR, f"{vid}_{i+1}.jpg"), quality=THUMB_Q, optimize=True)

    with open(os.path.join(ROOT, "tmp", f"{vid}.timeline.json"), "w", encoding="utf-8") as fh:
        json.dump({"id": vid, "duration": T, "scenes": timeline}, fh, indent=2)
    try:
        os.remove(silent)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--variant", choices=["hinglish"], default=None,
                    help="render the re-narrated variants (own id prefix + own folder)")
    ap.add_argument("--outdir", default=None, help="override the output folder for renders")
    args = ap.parse_args()

    if args.variant:
        globals()["CRF"] = VARIANT_CRF
    videos = variant_videos(args.variant) if args.variant else VIDEOS
    outdir = args.outdir or (os.path.join(VIDEO_DIR, args.variant) if args.variant else None)

    for v in videos:
        prefixes = args.only or []
        if args.variant:  # allow `--only K1` to match HI_K1_... as well
            prefixes = [p if p.startswith("HI_") else "HI_" + p for p in prefixes]
        if prefixes and not any(v["id"].startswith(p) for p in prefixes):
            continue
        print(f"=== {v['id']} ({v['duration']}s) {v['title']} ===")
        build(v, with_audio=not args.no_audio, preview=args.preview, outdir=outdir)


if __name__ == "__main__":
    main()
