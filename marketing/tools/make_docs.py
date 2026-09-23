#!/usr/bin/env python3
"""Generates docs/01-VIDEO-SCRIPTS.md from spec.py so timings can never drift
from the rendered files."""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec import BRAND, VIDEOS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

# Voice-over line per scene (last entry = end card). Concatenated they must equal
# the recorded narration in spec.py — asserted below.
SCENE_VO = {
    "K1_15s_live_tracking": [
        "Where is my child's bus?",
        "KidBus shows the live location",
        "and the exact ETA for every stop.",
        "Safer journeys, calmer mornings.",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K2_20s_boarding_verification": [
        "Is my child really on the bus? KidBus verifies every boarding and every drop in one tap by the conductor,",
        "and sends parents an instant alert the moment it happens.",
        "(manifest is visible to the school and the crew)",
        "No registers. No phone calls.",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K3_30s_sos_compliance": [
        "A medical emergency. A breakdown. A security concern. KidBus puts one SOS button in the driver's hand.",
        "The alarm reaches every school admin instantly, with the bus, the trip and the live location attached. "
        "An alarm sounds on the admin's screen until someone responds.",
        "Status moves from open, to acknowledged, to resolved.",
        "Plus automatic expiry alerts for insurance, fitness and driving licences.",
        "(no narration — visual breath before the brand card)",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K4_20s_compliance_documents": [
        "Insurance expiring next week? Fitness certificate missing?",
        "KidBus tracks every bus and driver document with automatic alerts, thirty days before expiry.",
        "(status: valid, expiring soon, expired)",
        "One school-wide compliance overview. No more lost files.",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K5_30s_school_operations": [
        "Running a school transport desk should not mean registers and phone calls.",
        "KidBus imports your students, parents, buses and routes from Excel in minutes,",
        "exports any report in one click, and gives you attendance, trip and bus utilisation data.",
        "One dashboard for your entire fleet. Every school gets its own subscription plan, limits and privacy.",
        "(no narration — visual breath before the brand card)",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K6_30s_all_in_one": [
        "One platform for your entire school transport operation.",
        "Live GPS tracking,",
        "boarding and drop verification, ETA and stop arrivals,",
        "SOS with an admin siren,",
        "compliance documents, and one-click reports. For school admins, drivers, conductors and parents. "
        "On web, on mobile, and in Hindi for your crew.",
        "One app your whole school can actually use. KidBus, by ZeroMileSystems.com.",
    ],
    "K7_20s_geofence_eta": [
        "Your bus enters the stop geofence,",
        "and every waiting parent is notified instantly.",
        "KidBus calculates an ETA for every remaining stop and marks arrivals automatically.",
        "Drivers drive. The system does the talking.",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K8_30s_reports_data": [
        "Attendance you cannot argue with. KidBus logs every boarding, drop, trip and stop arrival with timestamps.",
        "Fifteen built-in reports,",
        "each exportable to Excel in one click.",
        "Bulk import your whole school from a spreadsheet, with a validation dry run first. "
        "No more registers. No more re-typing. Reports that match the screen, every single time.",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K9_20s_role_privacy": [
        "KidBus keeps every family in the loop, but only their own. Parents see their children, their bus and their stop.",
        "School admins see the whole fleet.",
        "Drivers get a simple crew app.",
        "One platform, four experiences, complete privacy.",
        "KidBus, by ZeroMileSystems.com.",
    ],
    "K10_15s_brand_tagline": [
        "KidBus. School transport, completely visible. Live tracking, verified boarding, instant SOS,",
        "and reports your school will love.",
        "Free pilot for your school today. KidBus, by ZeroMileSystems.com.",
    ],
    "K11_60s_sales_film": [
        "Every morning, thousands of school buses leave the gate, and nobody really knows what happens "
        "next. Paper registers, phone calls, parents waiting with no information.",
        "KidBus changes that. The driver's app shares live GPS, and starts on its own when the trip begins.",
        "The conductor marks every boarding and drop in one tap, and parents are notified instantly.",
        "Parents see their child's bus on a live map, with alerts the moment it matters.",
        "Every stop arrival is detected automatically, and every remaining stop gets a live ETA.",
        "If something goes wrong, one tap raises an SOS on every admin's screen, with the trip and the "
        "location attached.",
        "In the office, every bus and driver document is tracked, with alerts thirty days before expiry.",
        "Attendance, trips and vehicle utilisation become reports you can export to Excel in one click.",
        "Your entire school, onboarded from a spreadsheet in minutes.",
        "KidBus, by ZeroMileSystems.com. Book a free thirty-day pilot for your school today.",
    ],
}

PLATFORM = {
    "K1_15s_live_tracking": "Instagram Reels, WhatsApp status, Facebook (parents)",
    "K2_20s_boarding_verification": "Instagram Reels, school WhatsApp groups",
    "K3_30s_sos_compliance": "LinkedIn (school owners, principals), YouTube Shorts",
    "K4_20s_compliance_documents": "LinkedIn feed, transport managers",
    "K5_30s_school_operations": "LinkedIn (education SaaS buyers), YouTube Shorts",
    "K6_30s_all_in_one": "Website hero / LinkedIn pinned post / YouTube Shorts",
    "K7_20s_geofence_eta": "Instagram Reels, WhatsApp status",
    "K8_30s_reports_data": "LinkedIn (school administrators), school sales decks",
    "K9_20s_role_privacy": "Instagram Reels, LinkedIn",
    "K10_15s_brand_tagline": "Paid ads (Meta/Google), website banner, YouTube pre-roll",
    "K11_60s_sales_film": "School meetings, sales deck, website 'how it works', LinkedIn pinned post",
}

MOTION_LABEL = {
    "zoom_in": "slow push-in on subject",
    "zoom_out": "slow pull-back reveal",
    "pan_left": "slow lateral pan L→R content",
    "pan_right": "slow lateral pan R→L content",
}


def ts(sec: float) -> str:
    m, s = divmod(sec, 60)
    return f"{int(m):02d}:{s:04.1f}"


def norm(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip()


def build() -> str:
    out = [
        f"# {BRAND['product']} — Video Scripts (voice-over + on-screen text)",
        "",
        f"**Product:** {BRAND['product']}  |  **Company:** {BRAND['company']}  |  "
        f"**Contact:** {BRAND['email']}",
        "",
        "Eleven ready-to-post films: 15 s, 20 s, 30 s and one 60 s sales film. Every film is "
        "narrated by the same voice, "
        "in English (Indian accent, female), and every on-screen line is the short form of the spoken "
        "line so a viewer who watches without sound still gets the whole story.",
        "",
        "**Universal structure of every film**",
        "",
        "1. **Hook (0–4 s)** — the fear or the pain, stated as the parent or the school feels it.",
        "2. **Proof (mid)** — the feature that removes it, named plainly (never jargon).",
        "3. **Payoff (last feature scene)** — what the buyer's day looks like afterwards.",
        "4. **End card (last ~4 s)** — logo, `" + BRAND["company"] + "`, email, free-pilot offer.",
        "",
        "**Safe-zone rules used in every render:** all text sits inside the central 92 % "
        "(`192 px` below the top tag and `96 px` above the bottom edge) so Reels/Shorts UI never "
        "covers a word. Captions are burnt-in AND shipped as `.srt`.",
        "",
        "---",
        "",
    ]
    for v in VIDEOS:
        vid = v["id"]
        vo_lines = SCENE_VO[vid]
        joined = norm(" ".join(l for l in vo_lines if not l.startswith("(")))
        assert joined == norm(v["vo"]), f"VO mismatch in {vid}:\n  doc: {joined}\n  spec: {norm(v['vo'])}"
        assert len(vo_lines) == len(v["scenes"]), f"{vid}: {len(vo_lines)} VO lines vs {len(v['scenes'])} scenes"

        total_w = sum(s.get("w", 8) for s in v["scenes"])
        durs = [v["duration"] * s.get("w", 8) / total_w for s in v["scenes"]]
        if durs[-1] < 2.2:
            shift = 2.2 - durs[-1]
            durs[-1] = 2.2
            for i in range(len(durs) - 1):
                durs[i] -= shift * durs[i] / sum(durs[:-1])
        t = 0.0
        out += [
            f"## {vid.split('_', 1)[1].replace('_', ' ').title()} — `{vid}`",
            "",
            f"- **Title card:** {v['title']}",
            f"- **Length:** {v['duration']:.0f} seconds · 1080×1080 · 30 fps",
            f"- **Best for:** {PLATFORM[vid]}",
            "",
            "| # | Time | Visual | On-screen text | Voice-over |",
            "| - | ---- | ------ | -------------- | ---------- |",
        ]
        for i, (sc, d, vol) in enumerate(zip(v["scenes"], durs, vo_lines), 1):
            if sc.get("kind") == "cta":
                visual = "Logo end card + brand gradient background"
                text = f"**{BRAND['product']}** · {BRAND['tagline']}  \n`{BRAND['company']}`  \n"
                text += f"green pill: *{BRAND['cta']}*  \ncaption bar: `{BRAND['email']}`"
            else:
                visual = f"`{sc['img']}` — {MOTION_LABEL.get(sc.get('motion', 'zoom_in'), sc.get('motion'))}"
                hl = sc["hl"]
                chips = " · ".join(sc.get("chips", []))
                capt = f"{sc['cap'][0]} — {sc['cap'][1]}"
                text = f"**{hl}**"
                if chips:
                    text += f"  \n*{chips}*"
                text += f"  \ncaption bar: {capt}"
            out.append(f"| {i} | {ts(t)}–{ts(t + d)} | {visual} | {text} | {vol} |")
            t += d
        out += [
            "",
            f"**Full narration (copy-paste into any TTS):**  ",
            f"> {norm(v['vo'])}",
            "",
            "---",
            "",
        ]
    return "\n".join(out)


if __name__ == "__main__":
    os.makedirs(DOCS, exist_ok=True)
    path = os.path.join(DOCS, "01-VIDEO-SCRIPTS.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(build())
    print("wrote", path)
