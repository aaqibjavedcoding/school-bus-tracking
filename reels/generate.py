#!/usr/bin/env python3
"""KidBus promo reel generator — Instagram (1080x1920) + LinkedIn (1920x1080), Full HD, ~19-20s."""
import math, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FFMPEG = "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FPS = 30
XFADE = 0.45
OUT = os.path.dirname(os.path.abspath(__file__))

# ---------------- palette ----------------
BG_TOP = (9, 48, 60)
BG_BOT = (3, 18, 25)
TEAL = (12, 118, 138)
TEAL_D = (8, 64, 76)
PANEL = (13, 42, 53)
PANEL_LN = (28, 92, 106)
AMBER = (244, 166, 35)
AMBER_D = (201, 131, 25)
AMBER_L = (255, 203, 96)
INK = (245, 250, 252)
MUTE = (154, 194, 205)
RED = (238, 84, 74)
GREEN = (78, 205, 132)
DARK = (6, 28, 36)

# ---------------- easing ----------------
def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def eoc(x): x = clamp(x); return 1 - (1 - x) ** 3
def eio(x): x = clamp(x); return x * x * (3 - 2 * x)
def eob(x):  # ease out back
    x = clamp(x); c1 = 1.70158; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
def ap(tl, t0, t1):  # animation progress
    return clamp((tl - t0) / max(1e-6, t1 - t0))

# ---------------- fonts ----------------
_fc = {}
def F(fs, bold=True):
    fs = max(8, int(round(fs)))
    k = (fs, bold)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(FONT_B if bold else FONT_R, fs)
    return _fc[k]

def text_layer(lines, tracking_default=0):
    """lines: list of dict(t, fs, c, b=True, tr=0, pad=0) -> RGBA image, lines centered."""
    fonts, dims = [], []
    W = H = 4
    for ln in lines:
        f = F(ln["fs"], ln.get("b", True))
        tr = ln.get("tr", tracking_default)
        s = ln["t"]
        w = sum(f.getlength(ch) for ch in s) + tr * max(0, len(s) - 1)
        asc, desc = f.getmetrics()
        h = asc + desc
        fonts.append((f, tr, w, h, asc))
        W = max(W, int(math.ceil(w)) + 4)
        H += h + ln.get("pad", 0)
    img = Image.new("RGBA", (W, H + 4), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    y = 2
    for ln, (f, tr, w, h, asc) in zip(lines, fonts):
        x = (W - w) / 2
        for ch in ln["t"]:
            dr.text((x, y), ch, font=f, fill=ln["c"])
            x += f.getlength(ch) + tr
        y += h + ln.get("pad", 0)
    return img

def fit_fs(text, fs0, max_w, bold=True, tr=0):
    fs = fs0
    while fs > 12:
        f = F(fs, bold)
        if f.getlength(text) + tr * (len(text) - 1) <= max_w:
            return fs
        fs -= 2
    return fs

def put(base, layer, cx, y, alpha=1.0, scale=1.0):
    if alpha <= 0 or scale <= 0:
        return
    lw, lh = layer.size
    if scale != 1.0:
        lw = max(1, int(lw * scale)); lh = max(1, int(lh * scale))
        layer = layer.resize((lw, lh), Image.LANCZOS)
    if alpha < 1.0:
        layer = layer.copy()
        a = layer.getchannel("A").point(lambda v: int(v * alpha))
        layer.putalpha(a)
    base.paste(layer, (int(cx - lw / 2), int(y)), layer)

# ---------------- sprites ----------------
def spr_blob(color, size=256):
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2) / (size / 2)
    a = (np.clip(1 - d, 0, 1) ** 2.4 * 130).astype(np.uint8)
    im = Image.new("RGBA", (size, size), color + (0,))
    im.putalpha(Image.fromarray(a, "L"))
    return im

def spr_pin(S, body=AMBER, hole=(255, 255, 255)):
    s = int(200 * S)
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    cx, cy, r = s / 2, s * 0.36, s * 0.30
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    d.polygon([(cx - r * 0.84, cy + r * 0.35), (cx + r * 0.84, cy + r * 0.35), (cx, s * 0.97)], fill=255)
    hole_r = r * 0.46
    d.ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], fill=0)
    im = Image.new("RGBA", (s, s), body + (0,))
    im.putalpha(m)
    dd = ImageDraw.Draw(im)
    dd.ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], fill=hole + (255,))
    return im

def spr_bus(S, w=460):
    w = int(w * S); h = int(w * 0.5)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    body_y0, body_y1 = h * 0.16, h * 0.78
    # shadow
    d.ellipse([w * 0.06, h * 0.86, w * 0.94, h * 1.0], fill=(0, 0, 0, 70))
    # body
    d.rounded_rectangle([w * 0.02, body_y0, w * 0.98, body_y1], radius=h * 0.14, fill=AMBER + (255,))
    d.rectangle([w * 0.02, h * 0.60, w * 0.98, h * 0.70], fill=TEAL_D + (255,))  # stripe
    # roof sign
    d.rounded_rectangle([w * 0.36, h * 0.04, w * 0.64, body_y0 + 2], radius=h * 0.04, fill=(20, 22, 24, 255))
    # windshield (front = right)
    d.polygon([(w * 0.80, h * 0.24), (w * 0.94, h * 0.24), (w * 0.94, h * 0.54), (w * 0.80, h * 0.54)], fill=(16, 44, 56, 255))
    # windows
    for i in range(3):
        x0 = w * (0.08 + i * 0.24)
        d.rounded_rectangle([x0, h * 0.24, x0 + w * 0.18, h * 0.54], radius=h * 0.05, fill=(16, 44, 56, 255))
        d.line([x0 + w * 0.03, h * 0.30, x0 + w * 0.10, h * 0.48], fill=(60, 110, 125, 255), width=max(2, int(h * 0.03)))
    # headlight + bumper
    d.ellipse([w * 0.955, h * 0.62, w * 0.985, h * 0.70], fill=(255, 236, 170, 255))
    d.rounded_rectangle([w * 0.90, h * 0.74, w * 0.99, body_y1], radius=h * 0.03, fill=AMBER_D + (255,))
    # wheels
    wr = h * 0.16
    for cx in (w * 0.22, w * 0.72):
        d.ellipse([cx - wr, h * 0.98 - 2 * wr, cx + wr, h * 0.98], fill=(18, 22, 26, 255))
        d.ellipse([cx - wr * 0.45, h * 0.98 - wr * 1.45, cx + wr * 0.45, h * 0.98 - wr * 0.55], fill=(120, 132, 140, 255))
    return im

def spr_bell(S, color=AMBER):
    s = int(200 * S)
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    cx = s / 2
    d.pieslice([s * 0.18, s * 0.14, s * 0.82, s * 0.98], 180, 360, fill=255)   # dome
    d.rectangle([s * 0.18, s * 0.56, s * 0.82, s * 0.66], fill=255)
    d.ellipse([s * 0.12, s * 0.60, s * 0.88, s * 0.74], fill=255)               # skirt
    d.ellipse([cx - s * 0.09, s * 0.06, cx + s * 0.09, s * 0.20], fill=255)     # top nub
    d.ellipse([cx - s * 0.09, s * 0.74, cx + s * 0.09, s * 0.92], fill=255)     # clapper
    im = Image.new("RGBA", (s, s), color + (0,))
    im.putalpha(m)
    return im

def spr_shield(S):
    s = int(240 * S)
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pts = [(s * 0.5, s * 0.04), (s * 0.92, s * 0.18), (s * 0.88, s * 0.56),
           (s * 0.5, s * 0.96), (s * 0.12, s * 0.56), (s * 0.08, s * 0.18)]
    d.polygon(pts, fill=AMBER + (255,))
    inner = [(s * 0.5, s * 0.12), (s * 0.83, s * 0.22), (s * 0.80, s * 0.54),
             (s * 0.5, s * 0.87), (s * 0.20, s * 0.54), (s * 0.17, s * 0.22)]
    d.polygon(inner, fill=TEAL_D + (255,))
    d.line([(s * 0.32, s * 0.50), (s * 0.45, s * 0.64), (s * 0.70, s * 0.34)],
           fill=(255, 255, 255, 255), width=int(s * 0.075), joint="curve")
    return im

def spr_person(S, color):
    s = int(120 * S)
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([s * 0.30, s * 0.06, s * 0.70, s * 0.46], fill=color + (255,))
    d.pieslice([s * 0.14, s * 0.52, s * 0.86, s * 1.30], 180, 360, fill=color + (255,))
    return im

def spr_check_pill(S, color=TEAL, fg=(255, 255, 255), r=None):
    s = int(r * 2 * S) if r else int(84 * S)
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([2, 2, s - 2, s - 2], fill=color + (255,))
    d.line([(s * 0.26, s * 0.52), (s * 0.44, s * 0.70), (s * 0.76, s * 0.32)],
           fill=fg + (255,), width=int(s * 0.11), joint="curve")
    return im

def spr_mail(S, color=AMBER):
    s = int(160 * S)
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    wl = int(s * 0.055)
    d.rounded_rectangle([s * 0.08, s * 0.24, s * 0.92, s * 0.78], radius=s * 0.07, outline=color + (255,), width=wl)
    d.line([(s * 0.12, s * 0.30), (s * 0.5, s * 0.56), (s * 0.88, s * 0.30)], fill=color + (255,), width=wl, joint="curve")
    return im

def zm_mark(S):
    """Zero Mile Systems mark: teal Z strokes + amber pin."""
    w, h = int(560 * S), int(320 * S)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lw = int(46 * S)
    x0, x1 = w * 0.10, w * 0.90
    y0, y1 = h * 0.14, h * 0.86
    teal = (16, 128, 150)
    for seg in [[(x0, y0), (x1, y0)], [(x1, y0), (x0, y1)], [(x0, y1), (x1, y1)]]:
        d.line(seg, fill=teal + (255,), width=lw)
    for (px, py) in [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]:
        d.ellipse([px - lw / 2, py - lw / 2, px + lw / 2, py + lw / 2], fill=teal + (255,))
    pin = spr_pin(S * 1.05, body=AMBER)
    im.alpha_composite(pin, (int(w * 0.40 - pin.size[0] / 2), int(h * 0.50 - pin.size[1] * 0.55)))
    return im

# ---------------- background ----------------
_rng = np.random.default_rng(7)
def make_bg(W, H):
    top = np.array(BG_TOP, float); bot = np.array(BG_BOT, float)
    t = np.linspace(0, 1, H)[:, None, None]
    arr = (top[None, None, :] * (1 - t) + bot[None, None, :] * t).repeat(W, axis=1)
    # vignette
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = W / 2, H * 0.42
    d = np.sqrt(((xx - cx) / (W * 0.75)) ** 2 + ((yy - cy) / (H * 0.75)) ** 2)
    arr *= (1 - 0.35 * np.clip(d - 0.55, 0, 1) ** 1.5)[..., None]
    arr += _rng.normal(0, 3.2, (H, W, 1))  # grain
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    b1 = spr_blob(AMBER).resize((int(W * 0.9),) * 2)
    img.paste(b1, (int(W * 0.55), int(-H * 0.18)), b1)
    b2 = spr_blob(TEAL).resize((int(W * 1.0),) * 2)
    img.paste(b2, (int(-W * 0.35), int(H * 0.72)), b2)
    return img

# ---------------- maps ----------------
def norm_route():
    return [(0.07, 0.72), (0.26, 0.60), (0.38, 0.66), (0.55, 0.42), (0.72, 0.47), (0.90, 0.20)]

def route_px(pts, box):
    x0, y0, x1, y1 = box
    out = []
    for nx, ny in pts:
        out.append((x0 + nx * (x1 - x0), y0 + ny * (y1 - y0)))
    return out

def cumlens(pts):
    segs, total = [], 0.0
    for i in range(len(pts) - 1):
        L = math.dist(pts[i], pts[i + 1])
        segs.append(L); total += L
    return segs, total

def point_at(pts, segs, total, u):
    d = clamp(u) * total
    acc = 0.0
    for i, L in enumerate(segs):
        if d <= acc + L or i == len(segs) - 1:
            f = 0 if L == 0 else (d - acc) / L
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f
            y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f
            ang = math.degrees(math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]))
            return x, y, clamp(f), ang
        acc += L
    return pts[-1][0], pts[-1][1], 1.0, 0.0

def draw_route(dr, pts, t, color, width, dash=(26, 18), upto=1.0):
    """animated marching dashes along polyline, drawn up to fraction `upto`."""
    segs, total = cumlens(pts)
    dtarget = upto * total
    step = dash[0] + dash[1]
    acc = 0.0
    for i, L in enumerate(segs):
        n = max(2, int(L / 6))
        prev = pts[i]
        for j in range(1, n + 1):
            f = j / n
            cur = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                   pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)
            segd = acc + f * L
            if segd <= dtarget:
                phase = (segd - t * 90) % step
                if phase < dash[0]:
                    dr.line([prev, cur], fill=color, width=width)
            prev = cur
        acc += L

# ---------------- music ----------------
def _tone(f, dur, sr, harm=((1, 1.0),)):
    n = int(sr * dur)
    x = np.arange(n) / sr
    sig = np.zeros(n)
    for k, g in harm:
        sig += g * np.sin(2 * np.pi * f * k * x)
    return sig

def synth_music(path, T, sr=44100):
    n = int(sr * T)
    out = np.zeros(n)
    bpm = 100.0; beat = 60.0 / bpm; bar = 4 * beat
    roots = [65.41, 49.0, 55.0, 43.65]                      # C2 G1 A1 F1
    chords = [[261.6, 329.6, 392.0, 493.9], [196.0, 246.9, 293.7, 392.0],
              [220.0, 261.6, 329.6, 392.0], [174.6, 220.0, 261.6, 349.2]]
    mel_scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]
    mel_pat = [0, 2, 4, 3, 2, 4, 5, 4]
    def add(sig, start, gain):
        i0 = int(start * sr)
        i1 = min(n, i0 + len(sig))
        if i1 > i0:
            out[i0:i1] += gain * sig[:i1 - i0]
    n_bars = int(T / bar) + 1
    for b in range(n_bars):
        ci = b % 4
        t0 = b * bar
        for f in chords[ci]:  # pad
            sig = _tone(f, bar * 1.05, sr, harm=((1, 0.9), (2, 0.28), (3, 0.1)))
            env = np.minimum(1, np.arange(len(sig)) / (sr * 0.7))
            env *= np.minimum(1, (len(sig) - np.arange(len(sig))) / (sr * 0.7))
            add(sig * env, t0, 0.05)
        r = roots[ci]
        for q in range(4):  # bass
            sig = _tone(r, beat * 0.9, sr, harm=((1, 1.0), (2, 0.2)))
            env = np.exp(-np.arange(len(sig)) / (sr * 0.22))
            add(sig * env, t0 + q * beat, 0.12)
        if b > 0:
            for q in range(4):  # kick
                dur = 0.16
                x = np.arange(int(sr * dur)) / sr
                fpt = 45 + (120 - 45) * np.exp(-x * 45)
                ph = 2 * np.pi * np.cumsum(fpt) / sr
                add(np.sin(ph) * np.exp(-x * 34), t0 + q * beat, 0.5)
        if b > 1:
            for e in range(8):  # hats
                dur = 0.05
                noise = _rng.normal(0, 1, int(sr * dur))
                noise = np.diff(noise, prepend=0)
                noise *= np.exp(-np.arange(len(noise)) / (sr * 0.012))
                add(noise, t0 + e * beat / 2 + beat / 2, 0.05)
        for i, m in enumerate(mel_pat):  # pluck
            if (b + i) % 4 == 3 and m in (3,):
                continue
            f = mel_scale[m]
            dur = 0.5
            x = np.arange(int(sr * dur)) / sr
            sig = (np.sin(2 * np.pi * f * x) + 0.35 * np.sin(4 * np.pi * f * x)) * np.exp(-x * 7)
            add(sig, t0 + i * beat / 2, 0.16)
            add(sig, t0 + i * beat / 2 + beat * 0.75, 0.06)  # echo
    out = np.tanh(out * 1.4) * 0.82
    fade = int(sr * 0.6)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    st = np.stack([out, out], axis=1)
    pcm = (np.clip(st, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())

# ---------------- scene builders ----------------
class G:  # per-video globals
    pass

def build_assets(G):
    S = G.S
    A = {}
    A["bus"] = spr_bus(S, 430)
    A["bus_sm"] = spr_bus(S, 200)
    A["pin"] = spr_pin(S)
    A["bell"] = spr_bell(S)
    A["shield"] = spr_shield(S)
    A["mail"] = spr_mail(S)
    A["zm"] = zm_mark(S * (0.9 if G.V else 1.0))
    A["chk_teal"] = spr_check_pill(S, TEAL)
    A["chk_green"] = spr_check_pill(S, GREEN, DARK)
    A["digits"] = {d: text_layer([dict(t=str(d), fs=230 * S, c=AMBER_L)]) for d in "23456"}
    G.A = A

def panel(dr, box, fill=PANEL + (255,), outline=PANEL_LN + (255,), radius=36, width=3):
    dr.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def toast(base, G, cx, y, w, icon, title, sub, alpha=1.0, dy=0):
    S = G.S
    h = 150 * S
    lay = Image.new("RGBA", (int(w), int(h)), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=h * 0.28, fill=(17, 52, 66, 255), outline=(44, 110, 126, 255), width=max(2, int(3 * S)))
    isz = 84 * S
    d.ellipse([22 * S, (h - isz) / 2, 22 * S + isz, (h + isz) / 2], fill=(9, 34, 44, 255))
    if icon.size[0] > isz * 0.66 or icon.size[1] > isz * 0.66:
        sc = (isz * 0.62) / max(icon.size)
        icon = icon.resize((max(1, int(icon.size[0] * sc)), max(1, int(icon.size[1] * sc))), Image.LANCZOS)
    lay.alpha_composite(icon, (int(22 * S + (isz - icon.size[0]) / 2), int((h - icon.size[1]) / 2)))
    tf = F(38 * S); sf = F(29 * S, False)
    d.text((132 * S, h * 0.20), title, font=tf, fill=INK)
    d.text((132 * S, h * 0.56), sub, font=sf, fill=MUTE)
    put(base, lay, cx, y + dy, alpha)

# ---------------- scenes ----------------
def sc_hook(img, tl, dur, G):
    S, W, H, V, A = G.S, G.W, G.H, G.V, G.A
    dr = ImageDraw.Draw(img)
    li = G.li
    if li:
        eb = text_layer([dict(t="KIDBUS  —  SCHOOL BUS TRACKING PLATFORM", fs=27 * S, c=MUTE, tr=int(5 * S))])
        l1 = text_layer([dict(t="Every school day,", fs=fit_fs("Every school day,", 96 * S, W * 0.8), c=INK)])
        l2 = text_layer([dict(t="on the right track.", fs=fit_fs("on the right track.", 96 * S, W * 0.8), c=AMBER)])
        sb = text_layer([dict(t="One platform for schools, drivers and parents —", fs=31 * S, c=MUTE, b=False),
                         dict(t="live GPS, accurate ETA and safety alerts.", fs=31 * S, c=MUTE, b=False)])
    else:
        eb = text_layer([dict(t="KIDBUS  •  SCHOOL BUS TRACKING", fs=28 * S, c=MUTE, tr=int(6 * S))])
        l1 = text_layer([dict(t="Is the school bus", fs=fit_fs("Is the school bus", 92 * S, W * 0.86), c=INK)])
        l2 = text_layer([dict(t="late again?", fs=fit_fs("late again?", 100 * S, W * 0.86), c=AMBER)])
        sb = text_layer([dict(t="Track it LIVE — GPS • ETA • Alerts", fs=33 * S, c=MUTE, b=False)])
    ye = H * (0.30 if V else 0.24)
    put(img, eb, W / 2, ye, alpha=eoc(ap(tl, 0.2, 0.7)))
    pin = A["pin"]
    put(img, pin, W / 2, ye - pin.size[1] - 26 * S, alpha=eoc(ap(tl, 0.0, 0.5)), scale=0.35 + 0.65 * eob(ap(tl, 0.0, 0.7)))
    put(img, l1, W / 2, ye + 90 * S, alpha=eoc(ap(tl, 0.45, 1.0)))
    put(img, l2, W / 2, ye + 90 * S + l1.size[1] + 8 * S, alpha=eoc(ap(tl, 0.7, 1.25)))
    put(img, sb, W / 2, ye + 90 * S + l1.size[1] + l2.size[1] + 46 * S, alpha=eoc(ap(tl, 0.95, 1.5)))
    # road + bus driving in
    ry = H * (0.78 if V else 0.80)
    dr.line([(0, ry), (W, ry)], fill=(22, 62, 74, 255), width=int(8 * S))
    dashw = 60 * S
    x = -40 * S
    while x < W:
        dr.line([(x, ry + 26 * S), (x + dashw * 0.55, ry + 26 * S)], fill=(70, 112, 124, 255), width=int(5 * S))
        x += dashw
    bus = A["bus"]
    p = eoc(ap(tl, 0.55, 1.9))
    bx = -bus.size[0] + p * (W * 0.5 - bus.size[0] * 0.5 + bus.size[0])
    bob = math.sin(tl * 10) * 3.5 * S * p
    img.paste(bus, (int(bx - bus.size[0] / 2 + W * 0), int(ry - bus.size[1] + 14 * S + bob)), bus)

def _feature_header(img, G, tl, kicker, title, y_title, delay=0.05):
    S, W = G.S, G.W
    put(img, text_layer([dict(t=kicker, fs=26 * S, c=AMBER_L, tr=int(7 * S))]),
        W / 2, y_title - 66 * S, alpha=eoc(ap(tl, delay, delay + 0.45)))
    ttl = text_layer([dict(t=title, fs=fit_fs(title, 66 * S, W * 0.9), c=INK)])
    put(img, ttl, W / 2, y_title, alpha=eoc(ap(tl, delay + 0.12, delay + 0.6)))

def _map_panel(img, dr, G, tl, box, prog_speed=0.28):
    S = G.S
    panel(dr, box, radius=int(30 * S))
    x0, y0, x1, y1 = box
    # streets
    stc = (26, 66, 78, 255)
    i = x0 + 60 * S
    while i < x1:
        dr.line([(i, y0), (i, y1)], fill=stc, width=2); i += 120 * S
    i = y0 + 60 * S
    while i < y1:
        dr.line([(x0, i), (x1, i)], fill=stc, width=2); i += 110 * S
    dr.line([(x0, y1 * 0.98), (x1, y0 * 1.04)], fill=(34, 82, 96, 255), width=int(7 * S))
    pts = route_px(norm_route(), (x0 + 8 * S, y0 + 8 * S, x1 - 8 * S, y1 - 8 * S))
    segs, total = cumlens(pts)
    dr.line(pts, fill=(50, 96, 110, 255), width=int(9 * S), joint="curve")
    draw_route(dr, pts, tl, AMBER + (255,), int(9 * S), upto=1.0)
    # stops
    for u in (0.0, 0.55):
        x, y, _, _ = point_at(pts, segs, total, u)
        r = 13 * S
        dr.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 255), outline=TEAL + (255,), width=int(5 * S))
    ex, ey, _, _ = point_at(pts, segs, total, 1.0)
    # geofence pulse at destination
    for k in range(2):
        ph = (tl * 0.9 + k * 0.5) % 1.0
        rr = (20 + ph * 95) * S
        al = int(150 * (1 - ph))
        dr.ellipse([ex - rr, ey - rr, ex + rr, ey + rr], outline=AMBER + (al,), width=int(6 * S))
    pin_sm = G.A["pin"].resize((int(G.A["pin"].size[0] * 0.62), int(G.A["pin"].size[1] * 0.62)), Image.LANCZOS)
    img.paste(pin_sm, (int(ex - pin_sm.size[0] / 2), int(ey - pin_sm.size[1])), pin_sm)
    # live chip
    lw_, lh_ = 150 * S, 46 * S
    dr.rounded_rectangle([x0 + 22 * S, y0 + 18 * S, x0 + 22 * S + lw_, y0 + 18 * S + lh_], radius=lh_ / 2, fill=(10, 30, 40, 235))
    bl = 0.55 + 0.45 * math.sin(tl * 5)
    dr.ellipse([x0 + 40 * S, y0 + 18 * S + lh_ / 2 - 8 * S, x0 + 56 * S, y0 + 18 * S + lh_ / 2 + 8 * S],
               fill=(RED[0], RED[1], RED[2], int(255 * bl)))
    dr.text((x0 + 72 * S, y0 + 18 * S + lh_ * 0.22), "LIVE", font=F(28 * S), fill=INK)
    dr.text((x1 - 24 * S, y1 - 22 * S), "Green Park Route • Bus 12", font=F(26 * S, False), fill=MUTE, anchor="rs")
    # bus moving along route
    prog = clamp(tl * prog_speed + 0.06, 0, 0.82)
    bx, by, _, ang = point_at(pts, segs, total, prog)
    bus = G.A["bus_sm"].rotate(-ang, resample=Image.BICUBIC, expand=True)
    bob = math.sin(tl * 9) * 2.5 * S
    img.paste(bus, (int(bx - bus.size[0] / 2), int(by - bus.size[1] + 6 * S + bob)), bus)
    cr = 22 * S
    dr.ellipse([bx - cr, by - cr, bx + cr, by + cr], outline=AMBER + (220,), width=int(5 * S))

def sc_gps(img, tl, dur, G):
    S, W, H, V = G.S, G.W, G.H, G.V
    dr = ImageDraw.Draw(img)
    _feature_header(img, G, tl, "FEATURE 01", "Real-time GPS tracking", H * 0.13)
    sub = text_layer([dict(t="Watch the bus move live on the map —", fs=32 * S, c=MUTE, b=False),
                      dict(t="no more guessing, no more calls.", fs=32 * S, c=MUTE, b=False)])
    if V:
        box = (W * 0.055, H * 0.27, W * 0.945, H * 0.585)
        _map_panel(img, dr, G, tl, box)
        put(img, sub, W / 2, H * 0.645, alpha=eoc(ap(tl, 0.5, 1.0)))
        chips = [dict(t="Geofenced stops", fs=30 * S, c=INK), dict(t="Live parent map", fs=30 * S, c=INK),
                 dict(t="Driver GPS share", fs=30 * S, c=INK)]
        _chip_row(img, G, tl, chips, H * 0.745, delay=0.75)
    else:
        box = (W * 0.05, H * 0.28, W * 0.47, H * 0.86)
        _map_panel(img, dr, G, tl, box, prog_speed=0.24)
        put(img, sub, W * 0.71, H * 0.34, alpha=eoc(ap(tl, 0.5, 1.0)))
        bullets = ["Geofenced stop arrivals", "Live map for parents & admins", "Background GPS from the bus"]
        _bullet_list(img, G, tl, bullets, W * 0.545, H * 0.48)

def _chip_row(img, G, tl, chips, y, delay=0.0):
    S, W = G.S, G.W
    fs0 = chips[0]["fs"]
    gap = 20 * S
    while True:
        f = F(fs0)
        ws = [f.getlength(c["t"]) + 48 * S for c in chips]
        if sum(ws) + gap * (len(chips) - 1) <= W * 0.93 or fs0 <= 16:
            break
        fs0 -= 2
    x = W / 2 - (sum(ws) + gap * (len(chips) - 1)) / 2
    ch_h = 66 * S
    dr = ImageDraw.Draw(img)
    for i, (c, w) in enumerate(zip(chips, ws)):
        a = eoc(ap(tl, delay + i * 0.14, delay + i * 0.14 + 0.4))
        if a <= 0:
            x += w + gap; continue
        lay = Image.new("RGBA", (int(w), int(ch_h)), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        d.rounded_rectangle([0, 0, w - 1, ch_h - 1], radius=ch_h / 2, fill=(13, 44, 56, int(255 * a)), outline=(52, 116, 132, int(255 * a)), width=2)
        d.text((24 * S, ch_h * 0.22), c["t"], font=F(fs0), fill=(INK[0], INK[1], INK[2], int(255 * a)))
        put(img, lay, x + w / 2, y, alpha=1.0)
        x += w + gap

def _bullet_list(img, G, tl, bullets, x, y, gap_h=None):
    S = G.S
    gap = gap_h or 92 * S
    dr = ImageDraw.Draw(img)
    for i, b in enumerate(bullets):
        a = eoc(ap(tl, 0.55 + i * 0.2, 0.95 + i * 0.2))
        if a <= 0:
            continue
        cb = G.A["chk_teal"].resize((int(54 * S), int(54 * S)), Image.LANCZOS)
        put(img, cb, x + 27 * S, y + i * gap, alpha=a)
        t = text_layer([dict(t=b, fs=34 * S, c=INK, b=False)])
        put(img, t, x + 66 * S + t.size[0] / 2, y + i * gap - 6 * S, alpha=a)

def sc_board(img, tl, dur, G):
    S, W, H, V, A = G.S, G.W, G.H, G.V, G.A
    dr = ImageDraw.Draw(img)
    _feature_header(img, G, tl, "FEATURE 02", "Boarding & drop, verified", H * 0.13)
    sub = text_layer([dict(t="Every pick-up and drop-off confirmed —", fs=32 * S, c=MUTE, b=False),
                      dict(t="parents notified instantly.", fs=32 * S, c=MUTE, b=False)])
    y0 = H * (0.30 if V else 0.40)
    tw = W * (0.86 if V else 0.46)
    cx = W / 2 if V else W * 0.28
    a1 = eob(ap(tl, 0.4, 0.95)); a2 = eob(ap(tl, 1.15, 1.7))
    dy1 = (1 - a1) * -160 * S; dy2 = (1 - a2) * -160 * S
    hh = 150 * S
    toast(img, G, cx, y0, tw, A["chk_green"], "Aarav boarded the bus", "7:42 AM • Stop 3, Green Park", alpha=clamp(a1), dy=dy1)
    toast(img, G, cx, y0 + hh + 34 * S, tw, A["chk_green"], "Aarav dropped at school", "8:17 AM • Main Gate", alpha=clamp(a2), dy=dy2)
    bell = A["bell"]
    ang = math.sin((tl - 1.15) * 10) * math.exp(-max(0, tl - 1.15) * 1.6) * 16
    b = bell.rotate(ang, resample=Image.BICUBIC, expand=True)
    if V:
        put(img, b, cx + tw / 2 - 12 * S, y0 - b.size[1] * 0.42, alpha=clamp(eoc(ap(tl, 1.2, 1.7))))
    else:
        put(img, b, cx - tw / 2 - 90 * S, y0 + hh * 0.5 - b.size[1] / 2 + 120 * S, alpha=clamp(eoc(ap(tl, 1.2, 1.7))))
    if V:
        put(img, sub, W / 2, H * 0.615, alpha=eoc(ap(tl, 1.55, 2.0)))
        chips = [dict(t="Instant alerts", fs=30 * S, c=INK), dict(t="Verified crew", fs=30 * S, c=INK),
                 dict(t="Auto attendance", fs=30 * S, c=INK)]
        _chip_row(img, G, tl, chips, H * 0.72, delay=1.8)
    else:
        put(img, sub, W * 0.71, H * 0.42, alpha=eoc(ap(tl, 1.5, 1.95)))
        _bullet_list(img, G, tl, ["Instant parent notifications", "Verified crew & manifest", "Attendance, automated"],
                     W * 0.545, H * 0.56)

def sc_eta(img, tl, dur, G):
    S, W, H, V, A = G.S, G.W, G.H, G.V, G.A
    dr = ImageDraw.Draw(img)
    _feature_header(img, G, tl, "FEATURE 03", "Live ETA & smart alerts", H * 0.13)
    # countdown card
    cw, ch = (W * 0.8 if V else W * 0.36), H * 0.30
    cx = W / 2 if V else W * 0.30
    cy = H * (0.30 if V else 0.42)
    box = (cx - cw / 2, cy, cx + cw / 2, cy + ch)
    panel(dr, box, radius=int(34 * S))
    dr.text((box[0] + 34 * S, box[1] + 26 * S), "Next stop: Green Park Gate", font=F(28 * S, False), fill=MUTE)
    n = max(2, int(6 - max(0, tl - 0.55) * 1.1))
    dig = A["digits"][str(n)]
    prog = (6 - n) / 4.0
    put(img, dig, cx, box[1] + ch * 0.10, alpha=eoc(ap(tl, 0.4, 0.8)), scale=0.72)
    lbl = text_layer([dict(t="minutes away", fs=34 * S, c=MUTE, b=False)])
    put(img, lbl, cx, box[1] + ch * 0.70, alpha=eoc(ap(tl, 0.5, 0.9)))
    # linear progress under card
    pw = cw * 0.7
    dr.rounded_rectangle([cx - pw / 2, box[3] + 30 * S, cx + pw / 2, box[3] + 30 * S + 14 * S], radius=7 * S, fill=(20, 56, 68, 255))
    pe = clamp(tl / (dur - 0.6)) * pw
    if pe > 4:
        dr.rounded_rectangle([cx - pw / 2, box[3] + 30 * S, cx - pw / 2 + pe, box[3] + 30 * S + 14 * S], radius=7 * S, fill=AMBER + (255,))
    # notification toast slides down
    ny = H * (0.685 if V else 0.46)
    a = eob(ap(tl, 1.3, 1.9))
    toast(img, G, cx if V else W * 0.72, ny + (1 - a) * -220 * S, W * (0.8 if V else 0.44),
          A["bell"], "Bus arriving in 3 min", "Push alert • Parent app", alpha=clamp(a))
    sub = text_layer([dict(t="Reach the stop exactly on time.", fs=32 * S, c=MUTE, b=False)])
    if V:
        put(img, sub, W / 2, H * 0.815, alpha=eoc(ap(tl, 1.7, 2.1)))
    else:
        put(img, sub, W * 0.71, H * 0.66, alpha=eoc(ap(tl, 1.7, 2.1)))
        _bullet_list(img, G, tl, ["Dynamic stop-by-stop ETA", "Traffic-aware updates", "Instant push alerts"], W * 0.545, H * 0.74, gap_h=66 * S)

def sc_safety(img, tl, dur, G):
    S, W, H, V, A = G.S, G.W, G.H, G.V, G.A
    dr = ImageDraw.Draw(img)
    _feature_header(img, G, tl, "FEATURE 04", "Safety built in", H * 0.13)
    cx = W / 2 if V else W * 0.30
    cy = H * (0.36 if V else 0.52)
    # pulsing rings + shield
    for k in range(2):
        ph = (tl * 0.8 + k * 0.5) % 1.0
        rr = (120 + ph * 160) * S
        al = int(120 * (1 - ph))
        dr.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=RED + (al,), width=int(6 * S))
    put(img, A["shield"], cx, cy - A["shield"].size[1] / 2, alpha=eoc(ap(tl, 0.25, 0.7)), scale=eob(ap(tl, 0.25, 0.8)))
    # SOS pill
    wpill, hpill = 300 * S, 86 * S
    ya = cy + A["shield"].size[1] / 2 + 46 * S
    a = eoc(ap(tl, 0.7, 1.1))
    glow = 0.6 + 0.4 * math.sin(tl * 7)
    rr_box = [cx - wpill / 2, ya, cx + wpill / 2, ya + hpill]
    dr.rounded_rectangle(rr_box, radius=hpill / 2, fill=(RED[0], RED[1], RED[2], int(255 * a)))
    dr.rounded_rectangle([rr_box[0] - 6 * S, rr_box[1] - 6 * S, rr_box[2] + 6 * S, rr_box[3] + 6 * S],
                         radius=hpill / 2, outline=(RED[0], RED[1], RED[2], int(120 * a * glow)), width=int(5 * S))
    tw = F(44 * S).getlength("SOS ALERT")
    dr.text((cx - tw / 2, ya + hpill * 0.20), "SOS ALERT", font=F(44 * S), fill=(255, 255, 255, int(255 * a)))
    lines = ["One tap — school & parents notified", "Verified crew on every trip", "Compliance documents tracked"]
    if V:
        _bullet_list(img, G, tl, lines, W * 0.14, H * 0.66, gap_h=96 * S)
    else:
        _bullet_list(img, G, tl, lines, W * 0.545, H * 0.42, gap_h=100 * S)
        put(img, text_layer([dict(t="Because nothing matters more", fs=32 * S, c=MUTE, b=False),
                             dict(t="than their safety.", fs=32 * S, c=MUTE, b=False)]),
            W * 0.71, H * 0.76, alpha=eoc(ap(tl, 1.4, 1.9)))
    if V:
        put(img, text_layer([dict(t="Because nothing matters more than their safety.", fs=32 * S, c=MUTE, b=False)]),
            W / 2, H * 0.855, alpha=eoc(ap(tl, 1.4, 1.9)))

def sc_end(img, tl, dur, G):
    S, W, H, V, A = G.S, G.W, G.H, G.V, G.A
    dr = ImageDraw.Draw(img)
    y_kick = H * (0.115 if V else 0.10)
    y_mark = H * (0.255 if V else 0.285)
    y_wm = H * (0.40 if V else 0.452)
    y_div = H * (0.555 if V else 0.60)
    y_web = H * (0.645 if V else 0.685)
    y_mail = H * (0.735 if V else 0.775)
    y_cta = H * (0.815 if V else 0.845)
    y_tag = H * (0.915 if V else 0.945)
    put(img, text_layer([dict(t="PROUDLY BUILT BY", fs=28 * S, c=MUTE, tr=int(12 * S))]),
        W / 2, y_kick, alpha=eoc(ap(tl, 0.15, 0.6)))
    zm = A["zm"]
    put(img, zm, W / 2, y_mark - zm.size[1] / 2, alpha=eoc(ap(tl, 0.3, 0.8)), scale=0.55 + 0.45 * eob(ap(tl, 0.3, 0.95)))
    wm = text_layer([dict(t="ZERO MILE", fs=fit_fs("ZERO MILE", (84 if V else 72) * S, W * 0.8), c=INK, tr=int(4 * S)),
                     dict(t="S Y S T E M S", fs=34 * S, c=AMBER_L, tr=int(20 * S))])
    put(img, wm, W / 2, y_wm, alpha=eoc(ap(tl, 0.55, 1.05)))
    dw = W * 0.30 * eio(ap(tl, 0.9, 1.4))
    if dw > 2:
        dr.line([(W / 2 - dw / 2, y_div), (W / 2 + dw / 2, y_div)], fill=(60, 116, 132, 255), width=int(3 * S))
    by = text_layer([dict(t="KidBus — the school journey, reimagined.", fs=31 * S, c=MUTE, b=False)])
    put(img, by, W / 2, y_div + 30 * S, alpha=eoc(ap(tl, 1.0, 1.45)))
    web = text_layer([dict(t="ZeroMileSystems.com", fs=fit_fs("ZeroMileSystems.com", 72 * S, W * 0.85), c=AMBER)])
    put(img, web, W / 2, y_web, alpha=eoc(ap(tl, 1.2, 1.65)), scale=0.9 + 0.1 * eob(ap(tl, 1.2, 1.7)))
    mail = text_layer([dict(t="zeromilesystems@gmail.com", fs=fit_fs("zeromilesystems@gmail.com", 40 * S, W * 0.72), c=INK, b=False)])
    put(img, A["mail"], W / 2 - mail.size[0] / 2 - 34 * S, y_mail, alpha=eoc(ap(tl, 1.4, 1.8)), scale=0.42)
    put(img, mail, W / 2 + 30 * S, y_mail, alpha=eoc(ap(tl, 1.4, 1.8)))
    ca = eob(ap(tl, 1.7, 2.25))
    if ca > 0:
        ctw = F(37 * S).getlength("Request a Free Demo") + 130 * S
        cth = 88 * S
        lay = Image.new("RGBA", (int(ctw * ca) + 4, int(cth) + 4), (0, 0, 0, 0))
        dd = ImageDraw.Draw(lay)
        x0 = (lay.size[0] - ctw) / 2
        dd.rounded_rectangle([x0, 2, x0 + ctw, 2 + cth], radius=cth / 2, fill=AMBER + (255,))
        dd.text((x0 + 55 * S, 2 + cth * 0.22), "Request a Free Demo", font=F(37 * S), fill=(8, 34, 44))
        dd.polygon([(x0 + ctw - 60 * S, cth * 0.5 - 12 * S + 2), (x0 + ctw - 34 * S, cth * 0.5 + 2),
                    (x0 + ctw - 60 * S, cth * 0.5 + 12 * S + 2)], fill=(8, 34, 44))
        put(img, lay, W / 2, y_cta, alpha=1.0)
    put(img, text_layer([dict(t="Smart transport for every school", fs=26 * S, c=(96, 138, 150), b=False, tr=int(4 * S))]),
        W / 2, y_tag, alpha=eoc(ap(tl, 2.1, 2.5)))

# ---------------- engine ----------------
def compose(G, bg, scenes, starts, t, idx_total):
    frame = bg.copy()
    # active scene
    k = 0
    for i, st in enumerate(starts):
        if t >= st - 1e-6:
            k = i
    tl = t - starts[k]
    scenes[k][0](frame, tl, scenes[k][1], G)
    # crossfade into next
    if k + 1 < len(scenes) and t >= starts[k + 1]:
        a = (t - starts[k + 1]) / XFADE
        nxt = bg.copy()
        scenes[k + 1][0](nxt, t - starts[k + 1], scenes[k + 1][1], G)
        frame = Image.blend(frame, nxt, clamp(a))
    # progress bar + watermark
    dr = ImageDraw.Draw(frame, "RGBA")
    S, W, H = G.S, G.W, G.H
    n = len(scenes)
    m = 42 * S; gap = 10 * S
    sw = (W - 2 * m - gap * (n - 1)) / n
    for i in range(n):
        x0 = m + i * (sw + gap)
        seg_start = starts[i]
        seg_end = starts[i] + scenes[i][1] if i < n - 1 else idx_total
        fill_ = clamp((t - seg_start) / max(1e-6, seg_end - seg_start))
        dr.rounded_rectangle([x0, 22 * S, x0 + sw, 22 * S + 9 * S], radius=5 * S, fill=(255, 255, 255, 70))
        if fill_ > 0:
            dr.rounded_rectangle([x0, 22 * S, x0 + sw * fill_, 22 * S + 9 * S], radius=5 * S, fill=(255, 255, 255, 235))
    if k < n - 1 or t < starts[-1]:  # not on end card
        wm = text_layer([dict(t="ZeroMileSystems.com", fs=23 * S, c=(120, 158, 170), b=False, tr=int(2 * S))])
        put(frame, wm, W / 2, H - 60 * S, alpha=0.85)
    return frame

def make_video(name, W, H, li):
    G_ = G()
    G_.W, G_.H, G_.V, G_.li = W, H, H > W, li
    G_.S = min(W, H) / 1080.0
    build_assets(G_)
    dur = dict(hook=3.2, gps=3.6, board=3.4, eta=3.4, safe=3.4, end=4.2)
    if li:
        dur = dict(hook=3.5, gps=3.8, board=3.6, eta=3.5, safe=3.5, end=4.3)
    scenes = [(sc_hook, dur["hook"]), (sc_gps, dur["gps"]), (sc_board, dur["board"]),
              (sc_eta, dur["eta"]), (sc_safety, dur["safe"]), (sc_end, dur["end"])]
    starts = [0.0]
    for _, d in scenes[:-1]:
        starts.append(starts[-1] + d - XFADE)
    total = starts[-1] + scenes[-1][1]
    n_frames = int(round(total * FPS))
    bg = make_bg(W, H)
    wavp = os.path.join(OUT, f"{name}.wav")
    outp = os.path.join(OUT, f"{name}.mp4")
    print(f"[{name}] {W}x{H}, {n_frames} frames, {total:.2f}s — synth music…", flush=True)
    synth_music(wavp, total)
    cmd = [FFMPEG, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-i", wavp,
           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
           "-profile:v", "high", "-level", "4.2",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", outp]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[{name}] rendering {n_frames} frames…", flush=True)
    for i in range(n_frames):
        fr = compose(G_, bg, scenes, starts, i / FPS, total)
        proc.stdin.write(np.asarray(fr, dtype=np.uint8).tobytes())
        if i % 90 == 0:
            print(f"[{name}] {i}/{n_frames}", flush=True)
    proc.stdin.close()
    rc = proc.wait()
    os.remove(wavp)
    if rc != 0:
        raise RuntimeError(f"ffmpeg failed for {name}")
    sz = os.path.getsize(outp) / 1e6
    print(f"[{name}] DONE -> {outp} ({sz:.1f} MB)", flush=True)

if __name__ == "__main__":
    if os.environ.get("TEST"):
        G_ = G(); G_.W, G_.H, G_.V, G_.li = 270, 480, True, False; G_.S = 270 / 1080
        build_assets(G_)
        bg = make_bg(270, 480)
        scenes = [(sc_hook, 3.2), (sc_gps, 3.6), (sc_board, 3.4), (sc_eta, 3.4), (sc_safety, 3.4), (sc_end, 4.2)]
        starts = [0.0]
        for _, d in scenes[:-1]:
            starts.append(starts[-1] + d - XFADE)
        total = starts[-1] + scenes[-1][1]
        os.makedirs(os.path.join(OUT, "test"), exist_ok=True)
        for k in range(8):
            t = k * (total / 7.0)
            fr = compose(G_, bg, scenes, starts, t, total)
            fr.save(os.path.join(OUT, "test", f"smoke_{k}.png"))
        print("TEST OK", total)
        sys.exit(0)
    make_video("KidBus-Instagram-Reel-1080x1920", 1080, 1920, li=False)
    make_video("KidBus-LinkedIn-Video-1920x1080", 1920, 1080, li=True)
    print("ALL DONE")
