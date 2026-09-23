#!/usr/bin/env python3
"""Renders the static campaign assets (not video):

  statics/carousel_schools/01..06.jpg   1080x1350  Instagram / LinkedIn feed carousel
  statics/whatsapp/kidbus-one-pager.jpg 1080x1920  forwardable product sheet for school owners
  statics/whatsapp/kidbus-one-pager.pdf            same sheet, print/email friendly

The design language is lifted from the films (same fonts, same navy/gold tokens, same
kicker pill and footer) so a carousel and a Reel look like one campaign.

  python3 tools/make_statics.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_video as bv  # noqa: E402  (fonts, plates, logo mark, chip builder)
from spec import BRAND, ACCENTS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_CAROUSEL = os.path.join(ROOT, "statics", "carousel_schools")
OUT_WA = os.path.join(ROOT, "statics", "whatsapp")

M = bv.M                      # 64 px side margin, same as the films
W = bv.W                      # 1080
GOLD = (245, 166, 35)
GOLD_LIGHT = (253, 224, 71)
NAVY = (15, 23, 42)
WHITE = (255, 255, 255)
SLATE = (203, 213, 225)
MUTED = (148, 163, 184)
GREEN = ACCENTS["green"]

CAROUSEL_W, CAROUSEL_H = 1080, 1350
WA_W, WA_H = 1080, 1920


# --------------------------------------------------------------------------
# backgrounds
# --------------------------------------------------------------------------
def gradient(w: int, h: int) -> Image.Image:
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    top = np.array((13, 20, 38), dtype=np.float32)
    bot = np.array((5, 9, 20), dtype=np.float32)
    col = top * (1 - t) + bot * t                      # (h, 1, 3)
    img = np.repeat(col, w, axis=1)                    # (h, w, 3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xx - w * 0.18) / (w * 0.9)) ** 2 + ((yy - h * 0.12) / (h * 0.7)) ** 2)
    glow = np.clip(1 - r, 0, 1) ** 3 * 0.20
    img = img + glow[:, :, None] * np.array(GOLD, dtype=np.float32)[None, None, :]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def scrim(w: int, h: int) -> tuple[Image.Image, Image.Image]:
    """Strong enough to carry text over a bright bus — the films' scrim was tuned for
    video where the frame keeps moving; a still has to hold a headline."""
    top = np.clip(1 - np.linspace(0, 1, h)[:, None] / 0.88, 0, 1) ** 0.80
    bottom = np.clip((np.linspace(0, 1, h)[:, None] - 0.55) / 0.45, 0, 1) ** 1.10
    col = np.maximum(top * 0.94, bottom * 0.92)
    a = np.repeat(col, w, axis=1)
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    a = np.clip(a + np.clip(r - 0.78, 0, 1) * 0.55, 0, 1)
    layer = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), mode="L")
    return Image.new("RGB", (w, h), (0, 0, 0)), layer


def photo_bg(name: str, w: int, h: int, focus=(0.5, 0.42)) -> Image.Image:
    base = Image.open(bv.plate(name)).convert("RGB")
    scale = max(w / base.width, h / base.height)
    base = base.resize((int(base.width * scale + 1), int(base.height * scale + 1)), Image.LANCZOS)
    x = int((base.width - w) * focus[0])
    y = int((base.height - h) * focus[1])
    crop = base.crop((x, y, x + w, y + h))
    return ImageEnhance.Brightness(ImageEnhance.Color(crop).enhance(1.04)).enhance(0.82)


def bg_for(slide: dict, w: int, h: int) -> Image.Image:
    if slide.get("img"):
        canvas = photo_bg(slide["img"], w, h, slide.get("focus", (0.5, 0.42)))
        canvas.paste(*scrim(w, h))
        return canvas
    return gradient(w, h)


# --------------------------------------------------------------------------
# chrome
# --------------------------------------------------------------------------
def kicker(canvas: Image.Image, y: int = 64) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    f = bv.font("Bold", 30)
    text = BRAND["product"].upper()
    w = int(f.getlength(text) + 52 + 40)
    d.rounded_rectangle([M, y, M + w, y + 54], radius=27, fill=GOLD + (255,))
    bv.draw_bus_glyph(d, M + 22, y + 13, 27, NAVY + (255,))
    d.text((M + 22 + 40, y + 14), text, font=f, fill=NAVY + (255,))


def counter(canvas: Image.Image, i: int, n: int, y: int = 74) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    f = bv.font("SemiBold", 32)
    text = f"{i:02d} / {n:02d}"
    d.text((W - M - f.getlength(text), y), text, font=f, fill=(255, 255, 255, 170))


def watermark(canvas: Image.Image, y: int) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    f = bv.font("SemiBold", 30)
    text = f"by {BRAND['company']}"
    d.text((W - M - f.getlength(text), y), text, font=f, fill=(255, 255, 255, 190))


def footer(canvas: Image.Image, note: str = "") -> None:
    """One non-overlapping row: logo left, contact right, tagline only if the gap allows."""
    h = canvas.height
    d = ImageDraw.Draw(canvas, "RGBA")
    y = h - 118
    d.rectangle([M, y, W - M, y + 3], fill=GOLD + (200,))
    f = bv.font("SemiBold", 30)
    name = BRAND["product"]
    glyph_w = 54
    bv.draw_bus_glyph(d, M, y + 32, 30, GOLD + (255,))
    d.text((M + glyph_w, y + 36), name, font=f, fill=WHITE + (255,))

    fr = bv.font("SemiBold", 30)
    right = BRAND["company"]
    right_x = W - M - fr.getlength(right)
    d.text((right_x, y + 36), right, font=fr, fill=GOLD_LIGHT + (255,))

    gap_start = M + glyph_w + f.getlength(name) + 34
    gap = right_x - gap_start
    if note and gap >= 300:
        ft = bv.font("Regular", 26)
        text = note
        if ft.getlength(text) <= gap - 20:
            d.text((gap_start, y + 40), text, font=ft, fill=MUTED + (255,))


def blit(canvas: Image.Image, el: dict) -> None:
    canvas.paste(el["rgb"], (el["x"], el["y"]), el["mask"])


def body(canvas: Image.Image, xy, text: str, size: int = 40, fill=SLATE, maxw: int | None = None,
         lh: int | None = None) -> int:
    f = bv.font("Regular", size)
    d = ImageDraw.Draw(canvas, "RGBA")
    lines = bv.wrap(text, f, maxw or (W - 2 * M))
    x, y = xy
    for ln in lines:
        bv.draw_text(d, (x, y), ln, f, fill + (255,))
        y += lh or int(size * 1.32)
    return y


def headline(canvas: Image.Image, xy, text: str, size: int = 82, maxw: int | None = None) -> int:
    f = bv.font("ExtraBold", size)
    d = ImageDraw.Draw(canvas, "RGBA")
    lines = bv.wrap(text, f, maxw or (W - 2 * M))
    x, y = xy
    for ln in lines:
        bv.draw_text(d, (x, y), ln, f, (10, 14, 28, 255))
        bv.draw_text(d, (x, y - 3), ln, f, WHITE + (255,))
        y += int(size * 1.14)
    return y


def eyebrow(canvas: Image.Image, xy, text: str, accent=GOLD_LIGHT) -> int:
    f = bv.font("SemiBold", 32)
    d = ImageDraw.Draw(canvas, "RGBA")
    bv.draw_text(d, xy, text.upper(), f, accent + (255,), spacing=3)
    return xy[1] + 52


def badge_number(canvas: Image.Image, n: int) -> None:
    d = ImageDraw.Draw(canvas, "RGBA")
    f = bv.font("ExtraBold", 300)
    text = f"{n:02d}"
    d.text((W - M - f.getlength(text) + 26, 150), text, font=f, fill=(245, 166, 35, 26))


# --------------------------------------------------------------------------
# carousel
# --------------------------------------------------------------------------
SLIDES = [
    {
        "img": "06-bus-street",
        "focus": (0.5, 0.45),
        "eyebrow": "For school owners",
        "headline": "Five things your register cannot tell you",
        "body": "Swipe. If a parent calls at 7:40 a.m., you should be able to answer every one of these "
                "in five seconds.",
        "chips": ["Paper registers", "Phone calls", "Zero visibility"],
    },
    {
        "eyebrow": "01 · Live location",
        "headline": "Where the bus is, right now",
        "body": "The driver's app starts sharing GPS when the trip starts. One map shows every bus, with "
                "an ETA for each stop — no manual marking by anyone.",
        "chips": ["Live map", "ETA per stop", "Auto start"],
    },
    {
        "eyebrow": "02 · Verified boarding",
        "headline": "Which child is actually on the bus",
        "body": "The conductor taps once per child. Parents are notified the moment it happens, and the "
                "school keeps a timestamped record of every boarding and drop.",
        "chips": ["One tap", "Parent alert", "Audit trail"],
    },
    {
        "eyebrow": "03 · Emergency",
        "headline": "Who responded, and when",
        "body": "One tap raises an SOS on every admin's screen with a sound, carrying the bus, the trip "
                "and the live location. Status moves from open to acknowledged to resolved.",
        "chips": ["Admin siren", "Status tracked", "Full trail"],
    },
    {
        "eyebrow": "04 · Compliance",
        "headline": "Which document expires next week",
        "body": "RC, insurance, fitness, permit, pollution and every driver licence, tracked with "
                "automatic alerts thirty days before expiry.",
        "chips": ["Insurance", "Fitness", "Licences"],
    },
    {
        "img": "04-reunion",
        "focus": (0.5, 0.4),
        "eyebrow": "05 · The proof, in one click",
        "headline": "Attendance, trips and utilisation — exported to Excel",
        "body": "Fifteen built-in reports, the same filters as the screen, and a bulk import that takes "
                "your school's existing spreadsheet. That is the whole answer.",
        "chips": ["15 reports", "Excel / CSV", "Dry-run import"],
        "cta": True,
    },
]


def text_block(slide: dict, y0: int, target: Image.Image, x: int = M) -> Image.Image:
    """Draws eyebrow + headline + body + chips onto `target`; returns the target."""
    y = eyebrow(target, (x, y0), slide["eyebrow"]) + 42
    y = headline(target, (x, y), slide["headline"], size=82, maxw=W - x - M) + 34
    y = body(target, (x, y), slide["body"], size=42, fill=SLATE, maxw=W - x - M, lh=58)
    for el, _ in bv.layout_chips(slide["chips"], ACCENTS["gold"], y + 40):
        el = dict(el)
        el["x"] = el["x"] - M + x
        blit(target, el)
    if slide.get("cta"):
        draw_cta(target, x, y + 148)
    return target


def draw_cta(target: Image.Image, x: int, y0: int) -> None:
    d = ImageDraw.Draw(target, "RGBA")
    f = bv.font("ExtraBold", 40)
    text = "FREE 30-DAY PILOT"
    w = int(f.getlength(text) + 76)
    d.rounded_rectangle([x, y0, x + w, y0 + 74], radius=37, fill=GOLD + (255,))
    d.text((x + 38, y0 + 15), text, font=f, fill=NAVY + (255,))
    fb = bv.font("SemiBold", 32)
    d.text((x + w + 22, y0 + 21), BRAND["email"], font=fb, fill=WHITE + (240,))


def build_carousel() -> None:
    os.makedirs(OUT_CAROUSEL, exist_ok=True)
    n = len(SLIDES)
    for i, slide in enumerate(SLIDES, 1):
        canvas = bg_for(slide, CAROUSEL_W, CAROUSEL_H)
        kicker(canvas)
        counter(canvas, i, n)
        if slide.get("img"):
            # photo slides get their copy on a dark panel: a still cannot rely on a
            # moving frame to keep a bright bus behind the text
            layer = Image.new("RGBA", (CAROUSEL_W, CAROUSEL_H), (0, 0, 0, 0))
            text_block(slide, 300, layer, x=M + 36)
            bbox = layer.getbbox()
            panel = Image.new("RGBA", (CAROUSEL_W, CAROUSEL_H), (0, 0, 0, 0))
            pd = ImageDraw.Draw(panel, "RGBA")
            pd.rounded_rectangle([bbox[0] - 40, bbox[1] - 44, bbox[2] + 40, bbox[3] + 44],
                                 radius=34, fill=(8, 13, 26, 214), outline=GOLD + (90,), width=2)
            canvas.paste(panel, (0, 0), panel)
            canvas.paste(layer, (0, 0), layer)
        else:
            badge_number(canvas, i - 1)
            text_block(slide, 380, canvas)

        footer(canvas, note="school transport, completely visible")
        out = os.path.join(OUT_CAROUSEL, f"{i:02d}.jpg")
        canvas.convert("RGB").save(out, quality=90, optimize=True)
        print(f"[carousel] {os.path.relpath(out, ROOT)}")


# --------------------------------------------------------------------------
# WhatsApp one-pager
# --------------------------------------------------------------------------
FEATURES = [
    ("Live GPS tracking", "One map, ETA for every stop."),
    ("Verified boarding & drops", "One tap, parent notified instantly."),
    ("One-tap SOS + admin siren", "Every admin alarmed, location attached."),
    ("Compliance documents", "Alerts 30 days before expiry."),
    ("Reports & Excel export", "15 reports, one click to Excel."),
    ("Hindi app that speaks", "The crew app says each step out loud."),
]


def build_one_pager() -> None:
    os.makedirs(OUT_WA, exist_ok=True)
    canvas = gradient(WA_W, WA_H)
    d = ImageDraw.Draw(canvas, "RGBA")

    mark, mmask = bv.load_mark(210)
    canvas.paste(mark, ((WA_W - 210) // 2, 96), mmask)

    f = bv.font("ExtraBold", 112)
    tw = f.getlength(BRAND["product"])
    bv.draw_text(d, ((WA_W - tw) / 2, 340), BRAND["product"], f, WHITE + (255,))
    d.ellipse([(WA_W + tw) / 2 + 6, 340 + 88, (WA_W + tw) / 2 + 26, 340 + 108], fill=GOLD + (255,))

    f2 = bv.font("Medium", 38)
    t2 = BRAND["tagline"]
    bv.draw_text(d, ((WA_W - f2.getlength(t2)) / 2, 486), t2, f2, SLATE + (255,))

    d.rectangle([M, 570, WA_W - M, 573], fill=GOLD + (200,))
    f3 = bv.font("SemiBold", 32)
    bv.draw_text(d, (M, 604), "WHAT YOUR SCHOOL GETS", f3, GOLD_LIGHT + (255,), spacing=3)

    y = 686
    for i, (title, desc) in enumerate(FEATURES, 1):
        ft = bv.font("ExtraBold", 44)
        d.ellipse([M, y + 4, M + 60, y + 64], fill=GOLD + (255,))
        fn = bv.font("ExtraBold", 36)
        num = str(i)
        d.text((M + 30 - fn.getlength(num) / 2, y + 12), num, font=fn, fill=NAVY + (255,))
        bv.draw_text(d, (M + 86, y), title, ft, WHITE + (255,))
        y_end = body(canvas, (M + 86, y + 58), desc, size=34, fill=MUTED,
                     maxw=WA_W - M - 86 - M, lh=46)
        y = y_end + 26

    # offer band
    y0 = y + 10
    assert y0 + 232 < WA_H - 170, f"one-pager overflows: {y0 + 232} > {WA_H - 170}"
    d.rounded_rectangle([M, y0, WA_W - M, y0 + 232], radius=28, fill=(245, 166, 35, 26),
                        outline=GOLD + (200,), width=3)
    fo = bv.font("ExtraBold", 56)
    offer = "Free 30-day pilot"
    bv.draw_text(d, ((WA_W - fo.getlength(offer)) / 2, y0 + 30), offer, fo, GOLD_LIGHT + (255,))
    fs = bv.font("SemiBold", 36)
    sub = "for the first 10 schools this month"
    bv.draw_text(d, ((WA_W - fs.getlength(sub)) / 2, y0 + 106), sub, fs, WHITE + (235,))
    fe = bv.font("Bold", 42)
    msg = 'WhatsApp / DM "PILOT"'
    bv.draw_text(d, ((WA_W - fe.getlength(msg)) / 2, y0 + 160), msg, fe, WHITE + (255,))

    fy = WA_H - 150
    d.rectangle([M, fy, WA_W - M, fy + 3], fill=GOLD + (200,))
    fc = bv.font("SemiBold", 36)
    line1 = BRAND["email"]
    line2 = f"{BRAND['company']}  ·  web, Android and iOS"
    bv.draw_text(d, ((WA_W - fc.getlength(line1)) / 2, fy + 30), line1, fc, WHITE + (255,))
    fcg = bv.font("Regular", 32)
    bv.draw_text(d, ((WA_W - fcg.getlength(line2)) / 2, fy + 82), line2, fcg, MUTED + (255,))

    jpg = os.path.join(OUT_WA, "kidbus-one-pager.jpg")
    canvas.convert("RGB").save(jpg, quality=90, optimize=True)
    pdf = os.path.join(OUT_WA, "kidbus-one-pager.pdf")
    canvas.convert("RGB").save(pdf, "PDF", resolution=150.0)
    print(f"[whatsapp] {os.path.relpath(jpg, ROOT)}")
    print(f"[whatsapp] {os.path.relpath(pdf, ROOT)}")


if __name__ == "__main__":
    build_carousel()
    build_one_pager()
