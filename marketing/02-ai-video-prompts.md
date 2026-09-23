# 02 — AI Video Prompts (copy & paste)

> **Media lives outside this repository.** The finished MP4s, narration MP3s, scene plates and
> cover thumbnails are kept in the standalone *KidBus marketing pack* (git-ignored by design: they
> are ~90 MB of binaries). Paths such as `videos/`, `videos/9x16/`, `social/srt/`, `social/thumbs/`,
> `assets/ai/` and `tools/` in this folder refer to that pack. This folder is the source of truth for
> the *text*: scripts, prompts, captions and the client brief. Nothing here affects the product build.

Everything below is written to be pasted straight into an AI video tool: **Veo / Sora / Kling /
Runway / Pika / Hailuo** for footage, **Midjourney / Ideogram / DALL·E / Firefly** for stills,
**ElevenLabs / HeyGen / Murf / CapCut TTS** for the voice, and **CapCut / InVideo / Premiere** for
the edit. The rendered videos in `videos/` were built from exactly these prompts, so what you see
is what you get.

> **Rule 1 — never let the AI write your text.** Every generative tool misspells on-screen words.
> Generate the **footage only, always with "no text"**, then add headlines, chips and captions in the
> editor (or reuse the text layers from this pack).
>
> **Rule 2 — the narration carries the story, the text confirms it.** Assume 80 % of viewers watch on
> mute for the first second: hook with the headline, not with a paragraph.

---

## 1. Global style block (paste on top of every image prompt)

```text
STYLE BLOCK (append to every prompt):
photorealistic documentary photograph, Indian city setting, natural warm morning light,
shallow depth of field, 50mm lens look, cinematic colour grade in navy blue and school-bus
amber, authentic Indian middle-class context, natural skin tones, editorial advertising quality,
square 1:1 composition with clean empty space at the top and bottom for text overlay,
no text, no words, no letters, no numbers, no logos, no watermarks, no signage
```

**Negative prompt (all tools):**

```text
text, typography, captions, watermark, logo, extra fingers, deformed hands, distorted faces,
western school uniform, snow, european streets, cartoon, plastic skin, oversaturated hdr,
license plate numbers, brand names
```

---

## 2. Six reusable shot recipes

The eleven films reuse the same six shots, so you only need to generate these once and re-cut them.
Each recipe = **still prompt** → **motion prompt** (image-to-video) → **where it is used**.

### Shot A — "The 7 a.m. question" (parent worry)

**Still:**
```text
An Indian mother in her early thirties stands by a bright apartment window in the early morning,
holding her smartphone in both hands close to her chest, looking out towards the street with a
worried but hopeful expression. Neutral modern home interior in soft focus behind her.
[+ STYLE BLOCK]
```

**Motion (image-to-video):** `very slow push-in towards her face, subtle handheld drift, she glances
down at the phone screen then back out of the window, natural blinking, no camera shake, 5 seconds,
no text`

**Used in:** K1 scene 1, K2 scene 3, K5 scene 4, K7 scene 2, K9 scene 1.

---

### Shot B — "The register and the phone" (school pain)

**Still:**
```text
A small Indian school office desk in the morning: a landline phone handset off the hook, a thick
paper attendance register lying open, a messy stack of files and envelopes, a wall clock, a notice
board with pinned blank papers blurred behind, an empty chair. Warm daylight from a window on the
left, slightly cluttered and old-fashioned.
[+ STYLE BLOCK]
```

**Motion:** `slow pull-back reveal of the cluttered desk, dust motes in the window light, the phone
handset cord sways very slightly, static camera, 5 seconds, no text`

**Used in:** K2 scene 4, K3 scene 2, K4 scene 1, K5 scene 1, K6 scene 5, K8 scene 1, K9 scene 2.

---

### Shot C — "Boarding, verified" (the trust shot)

**Still:**
```text
A female school bus attendant in a neat uniform helps a smiling seven-year-old Indian child with a
backpack step up the stairs of a bright yellow school bus, the child's small hand in hers, other
children with backpacks waiting in a soft-focus queue behind, clean residential street in India,
trees along the road, hopeful and safe mood.
[+ STYLE BLOCK]
```

**Motion:** `slight push-in, the attendant's hand steadies the child's arm, the child steps up, warm
sun flare, gentle handheld, 5 seconds, no text`

**Used in:** K2 scene 1, K6 scene 3.

---

### Shot D — "Home safe" (payoff / relief)

**Still:**
```text
An Indian child with a school backpack runs into a warm hug with their mother at a residential gate
in the late afternoon; both are smiling, the mother's eyes closed in relief, arms wrapped around the
child, soft bokeh trees and a quiet street behind, warm golden backlight.
[+ STYLE BLOCK]
```

**Motion:** `slow push-in as the child runs into the hug, hair and dupatta move in the breeze, warm
golden flare, slight speed ramp, 5 seconds, no text`

**Used in:** K1 scene 4, K3 scene 5, K5 scene 5, K9 scene 1 (alt), K10 scene 2.

---

### Shot E — "The crew cockpit" (SOS + documents)

**Still:**
```text
Inside a moving school bus in India: an Indian male driver in a light blue uniform shirt behind the
steering wheel, glancing toward a smartphone mounted on the dashboard, the phone screen glowing with
a blurred unreadable interface, morning light through the windshield, clean dashboard, calm serious
expression.
[+ STYLE BLOCK]
```

**Motion:** `slow lateral dolly past the driver, the bus interior vibrates subtly as the road moves
outside the windshield, he taps the phone once, 5 seconds, no text`

**Used in:** K3 scenes 1 & 4, K4 scene 2, K6 scene 4, K7 scene 4, K8 scene 4, K9 scene 3.

---

### Shot F — "The bus on your street" (connection to everyday life)

**Still:**
```text
A bright yellow school bus with its door open waits at the side of a tree-lined residential street in
an Indian city; children with backpacks walk towards it, an auto rickshaw and green trees in the
soft-focus background, warm morning light with long shadows.
[+ STYLE BLOCK]
```

**Motion:** `slow lateral pan following the bus, children walk towards the door, an auto rickshaw
passes in the background, long morning shadows, 5 seconds, no text`

**Used in:** K1 scene 3, K2 scene 3, K4 scene 4, K5 scene 2, K6 scene 1, K7 scene 1, K8 scene 3,
K10 scene 1.

---

### Bonus shot — product UI (do **not** let AI invent this)

AI tools cannot draw your real product. Generate only the **device frame** and composite your real
screenshot on top in the editor:

```text
A modern smartphone in portrait orientation floats centred against a deep navy blue studio
background, the screen facing the camera and glowing brightly. The screen content is a flat neutral
grey placeholder plane with no detail. Soft studio lighting, subtle reflection, premium tech
advertising look, sharp device edges.
[+ STYLE BLOCK]
```

Then drop a real KidBus screenshot (web console `/tracking`, or the mobile `/tracking` screen) onto
the screen area, and add a soft screen glow in the editor. Never fake a UI with AI text — a
school principal will zoom in.

---

## 3. One-shot prompts (for Sora / Veo / Kling "generate the whole clip" mode)

Use these when the tool wants a single prompt instead of a storyboard.

**15-second version**

```text
A 15 second 1:1 square social ad for a school-bus tracking product. Morning light, authentic Indian
city. Shot 1: an Indian mother by a window, worried, phone in both hands. Shot 2: a bright yellow
school bus driving through a tree-lined residential street, seen from a low tracking angle. Shot 3: a
school attendant helps a small child with a backpack onto the bus; cut to the child running into the
mother's hug in the afternoon. Warm, hopeful, cinematic, navy and amber colour grade, shallow depth
of field, documentary advertising quality, smooth slow camera moves, no on-screen text, no logos.
```

**20-second version** — same as above plus: `…and one shot inside the bus of the driver glancing at a
dashboard phone, and one shot of a school office desk with a paper attendance register and a phone
off the hook.`

**30-second version** — same as above plus: `…and one shot of the child boarding, one shot of the
empty school office at the end of the day, and a final wide shot of the bus pulling away from a
school gate at golden hour.`

> Keep the AI clips 4–6 seconds each and cut them yourself. One-shot 30 s generations drift and
> lose the brand look by the third scene.

---

## 4. Voice-over

**Voice settings that worked (and are baked into the MP4s):**

| Setting | Value |
| --- | --- |
| Language / accent | English, Indian (en-IN) |
| Gender / style | Female, warm, confident, "trusted teacher" energy — not shouty ad-read |
| Pace | ~150 words per minute (the 30 s films have ~75 words) |
| Pitch / energy | Level; land the brand line slightly slower and lower |
| Pauses | Half-beat after the hook question and before the brand line |

**TTS instruction block (paste into ElevenLabs / Murf / HeyGen):**

```text
Read as a friendly, credible Indian woman explaining something important to parents and school
principals. Warm, calm, confident. Slight pause after the opening question. Emphasise the product
name "KidBus" and the company name "ZeroMileSystems.com" clearly and slowly. Do not sound like a
loud commercial. Natural Indian English pronunciation.
```

The exact narration for all eleven films is in [`01-VIDEO-SCRIPTS.md`](./01-video-scripts.md) — copy it
straight out of the "Full narration" line of each film.

---

## 5. Edit plan (timings that match the shipped videos)

| Length | Beats | Scene durations (approx.) |
| --- | --- | --- |
| **15 s** | Hook → feature → payoff → end card | 5.5 / 4.5 / 3.5 / 3.5 s |
| **20 s** | Hook → feature → proof → outcome → end card | 4 / 4 / 4 / 4 / 4 s |
| **30 s** | Hook → feature → feature → proof → outcome → end card | 4 / 4.5 / 5 / 4.5 / 4 / 4 s |

**Technical spec of the shipped files:** `1080 × 1080`, `30 fps`, H.264 (`yuv420p`, CRF 19),
AAC 192 kbps 48 kHz stereo, `+faststart` (streams instantly on LinkedIn/Instagram).

**Cut rules used**

- Every scene change is a **0.38 s cross-dissolve** — no hard cuts, keeps a calm, trustworthy tone.
- Each new scene opens with a **quiet whoosh**; the feature scenes add a **soft bell** on the first word.
- The emergency film adds a **red pulse + low alarm sting** to make the SOS scene physically feel different.
- Bottom **progress bar** is amber and grows with the film — it subconsciously tells viewers "this is short".
- Caption bar is always in the same place with the same shape, so the eye stops hunting.

**Music (not bundled — licence one of these):**

| Source | Track type | Notes |
| --- | --- | --- |
| YouTube Audio Library (free) | "Warm piano + light percussion, 90–100 BPM" | Search *inspirational corporate light*; free with attribution optional |
| Pixabay Music (free) | *uplifting documentary*, *soft corporate* | CC0, safe for client work |
| Artlist / Epidemic (paid) | "Trust" playlists | Best if you run paid ads (clean licensing for commercial use) |

Mix: music **−22 dB to −18 dB** under the narration, duck 4 dB more whenever the voice speaks, hard
drop of music for 0.3 s right before the end card so the brand line lands clean.

---

## 6. Platform export presets

| Target | Spec | How (from this pack) |
| --- | --- | --- |
| Instagram Reels / Stories | 1080 × 1920, 9:16 | 1:1 master plays fine, but for full-screen: see command below |
| Instagram feed | 1080 × 1080 | ✅ nothing to do — the masters are already 1:1 |
| LinkedIn feed | 1080 × 1080 or 1080 × 1350 | ✅ 1:1 native, highest completion rate in-feed |
| YouTube Shorts | 1080 × 1920, ≤ 60 s | 1:1 is accepted (letterboxed) |
| Website hero / YouTube pre-roll | 1920 × 1080, 16:9 | command below |

**Easiest path — already shipped:** every film has a 9:16 cut in `videos/9x16/`, and K6 + K11 also have
16:9 cuts in `videos/16x9/`. Regenerate or extend with:

```bash
python3 tools/export_versions.py          # all verticals + the two hero landscapes
python3 tools/export_versions.py --all    # landscape for every film as well
python3 tools/export_versions.py K3 K8    # only these two, both orientations
```

Manual ffmpeg equivalent (blurred-fill edges, keeps the text exactly where it is):

```bash
ffmpeg -i videos/K1_15s_live_tracking.mp4 -vf "\
[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2[bg];\
[0:v]scale=1080:1080[fg];[bg][fg]overlay=0:(H-h)/2" -c:a copy K1_9x16.mp4
```

Make a 16:9 version for LinkedIn desktop / YouTube:

```bash
ffmpeg -i videos/K1_15s_live_tracking.mp4 -vf "\
[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:2[bg];\
[0:v]scale=1080:1080[fg];[bg][fg]overlay=(W-w)/2:0" -c:a copy K1_16x9.mp4
```

---

## 7. Honest production notes

- The shots shipped in `videos/` are **AI-generated stills with Ken-Burns motion**, not live
  footage. They are perfect for a fast, cheap, good-looking launch. They will *not* beat real
  footage of a real school.
- **The fastest quality upgrade:** shoot 30 minutes at any partner school (bus arriving, children
  boarding with the attendant, driver checking the phone, the child's hug at the gate) and drop the
  clips into the same edit plan and timings — the pack is built so nothing else has to change.
- Use **only real KidBus screenshots** for any UI shot. The mockup in the pack is deliberately
  blurred so it cannot be mistaken for a live screen.
- If a school is in the frame, take written consent from the school and the parents before posting.
  Never show a real child's face in an ad without that consent — this is non-negotiable for a
  child-safety product, and it is exactly the promise the product itself makes.
