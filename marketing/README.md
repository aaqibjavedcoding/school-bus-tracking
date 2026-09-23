# KidBus — Marketing & Launch Copy

**Product:** KidBus · **Company:** ZeroMileSystems.com · **Contact:** zeromilesystems@gmail.com

This folder is the **text source of truth** for the KidBus launch campaign: the video scripts, the
AI-video prompts, the social captions and the client-facing feature brief. The rendered media
(`.mp4`, `.mp3`, scene plates, thumbnails) deliberately lives **outside** this repository in the
standalone *KidBus marketing pack* — it is ~90 MB of binaries and has no business in a product repo.

> Nothing in this folder is imported by the product build. It is inert copy + tooling: no dependency,
> no CI job and no runtime path in `web/`, `mobile/` or `packages/` touches it.

---

## What is here

| File | What it is | Use it when |
| --- | --- | --- |
| [`01-video-scripts.md`](./01-video-scripts.md) | Scene-by-scene script for **11 films** (15 s / 20 s / 30 s / 60 s): timings, on-screen text, narration, captions | Writing a new film, or briefing an editor/TTS |
| [`02-ai-video-prompts.md`](./02-ai-video-prompts.md) | Copy-paste prompts for AI video tools (Veo/Sora/Kling/Runway), TTS settings, edit plan, music, export presets | Generating new footage or a Hindi/regional cut |
| [`03-social-kit.md`](./03-social-kit.md) | Per-film captions for Instagram + LinkedIn, hashtag sets, 4-week posting calendar, WhatsApp/email pitch text | Posting anything, any day |
| [`04-feature-brief.md`](./04-feature-brief.md) | One-page client brief of the shipped product: what each role gets, technical Q&A, pilot structure, objection handling | Sales calls, proposals, onboarding a school |
| [`srt/`](./srt) | Subtitle files for all 11 films | LinkedIn/YouTube upload, or burning open captions |
| [`tools/`](./tools) | The render pipeline (`spec.py` = the copy incl. the `HINGLISH` narration table, `build_video.py` = the look + `--variant hinglish`, `export_versions.py` = 9:16/16:9 cuts, `make_statics.py` = carousel + one-pager, `make_docs.py` = regenerates `01-video-scripts.md` from the spec) | Re-rendering after a copy change |

The two campaign facts worth repeating, because they are what actually gets a school to say yes:

1. **The crew app speaks.** In a loud bus nobody reads a screen, so a confirmed tap flashes the row,
   updates the text, announces it for the screen reader, **and the phone says it and vibrates** —
   *"Ramesh ka boarding ho gaya, 7:42 subah"* / *"Priya utar gayi, 3:10 dopahar"*.
2. **The app is fully in Hindi**, and the voice lines are Hinglish in Latin script on purpose, so they
   work on budget Android phones that ship without a `hi-IN` TTS voice. Details and the honest
   limitation (the drop line does not gender-agree) are in [`docs/mobile-ux.md`](../docs/mobile-ux.md).

---

## The campaign in one screen

**Story:** the parent's 7 a.m. question ("where is my child's bus?") → the feature that answers it →
the proof (verified boarding, geofence arrival, live ETA) → the worst day, handled (one-tap SOS →
admin siren) → the office side (documents, reports, Excel) → *free 30-day pilot*.

**Assets:** 11 films, each in square (feed), 9:16 (Reels/Shorts) and — for the two hero films — 16:9
(website/LinkedIn desktop). Every film ends on the same end card: **KidBus · ZeroMileSystems.com ·
zeromilesystems@gmail.com · Free pilot for your school**.

**Call to action:** *DM "PILOT" for a free 30-day pilot* — one CTA everywhere, so response can be
counted in one inbox.

**Language variants:** five of the films (K1, K2, K6, K7, K10 — the ones a parent-facing Instagram
audience sees) also exist with a **Hinglish narration**: identical visuals, timings and English
on-screen text, only the voice changes, rendered as `HI_*` files. Hinglish captions for those five are
in `03-social-kit.md`. The choice mirrors the product itself — Hindi for the crew, English chrome on
the console — because the parent audience in the Hindi belt watches with sound on, while school owners
read on mute in a LinkedIn feed.

**First ten days (from [`03-social-kit.md`](./03-social-kit.md)):** K1 (live tracking) → K3 (SOS) →
K2 (boarding alerts) → K4 (documents) → K10 (brand, as a ₹300–500/day ad test) → K6 (all-in-one,
pinned) → K11 (60 s sales film, sent 1-to-1 to principals).

**What to measure:** 3-second hold rate (> 55 % on the 15 s films), average watch time (> 60 % of
runtime), and the only number that matters commercially — **PILOT messages received**.

---

## Regenerating a film

```bash
# in the standalone marketing pack (the one that also holds assets/ and voiceover/)
python3 tools/build_video.py --only K1 --preview   # fast layout check, no video written
python3 tools/build_video.py --only K1             # re-render that film
python3 tools/export_versions.py K1                # 9:16 (+ 16:9 for hero films)
python3 tools/make_docs.py                         # refresh 01-video-scripts.md from spec.py
```

`tools/spec.py` holds the narration wording, scene images, headlines, chips and caption bars — change
the story there, never in the rendered output. Scene durations are derived from per-scene word
weights, so retiming a beat means editing one number. `tools/make_docs.py` asserts that the doc's
narration matches the spec, so the script file can never silently drift from the videos.

Requirements for re-rendering: `python3` with `pillow`, `numpy`, `imageio-ffmpeg` (bundled ffmpeg).
The voice-over MP3s are pre-generated; drop human recordings in with the same file names to
re-render with a real voice.

---

## Honesty notes (keep these in the copy you publish)

- The scene plates are **AI-generated stills animated with slow camera moves**, not live footage —
  good enough for launch, and the edit plan is built so real footage can be dropped in unchanged.
- Any **product UI** shown in the films is a stylised mockup; use real KidBus screenshots for the
  website, decks and paid creative.
- Get **written consent** from the school and the parents before publishing any real child's image.
  A child-safety product cannot afford to be sloppy about this — it is the same promise the product
  makes to its users.
