# ARTech POS — Marketing Video

**`artech-pos-promo.mp4`** — a 19.7-second product promo for ARTech POS.

| | |
|---|---|
| **Length** | 19.73 s (592 frames) |
| **Format** | MP4 · H.264 (High profile) · 1920×1080 · 30 fps |
| **Audio** | AAC-LC · 48 kHz stereo · 192 kbps (voice-over + music + SFX) |
| **Size** | ~3.1 MB |
| **Branding** | `public/brand/logo.png` adapted into a **circular lockup** (opening + closing) — the mark fills a round badge, it is not a rectangle dropped onto a disc |

## Storyboard

All cuts land on the music grid (112.5 BPM, beat = 0.533 s).

| Time | Scene | What it shows |
|---|---|---|
| 0.00 – 2.67 | **Hook** | "LONG LINES?" → "NO INTERNET?" → **"NO PROBLEM."** with a queue of customers and a dying Wi-Fi icon |
| 2.67 – 4.27 | **Logo reveal** | Circuit traces meet a spinning circular badge; the ARTech POS mark is clipped to the round disc (no rectangular card) |
| 4.27 – 7.47 | **Desktop POS** | Full desktop POS: search + barcode scan, items ringing into the cart, live total, **Charge → cha-ching + receipt prints** |
| 7.47 – 11.73 | **Hold** | A second customer arrives → cashier taps **Hold** (F8) → sale moves to the "On hold" tray → next customer is served → held sale is **resumed** |
| 11.73 – 14.93 | **Offline** | Wi-Fi dies → **"NO INTERNET"** banner → sales keep ringing up → *3 sales queued locally* → back online → **synced to the cloud** |
| 14.93 – 17.07 | **Adaptability** | The same POS on **desktop, PC (laptop) and mobile** with a sync pulse travelling across all three |
| 17.07 – 19.73 | **Call to action** | Logo + tagline, **"Start free — 15-day trial"**, `artech-pos.pages.dev`, plans from ₱149/month |

## Voice-over script

> Long lines? No internet? No problem. Meet ARTech POS. A full point of sale, right on your desktop. Queue too long? Hold the sale, serve the next, resume anytime. No internet? Keep selling, and sync when you're back. Desktop, mobile, PC — one POS, everywhere. Manage. Sell. Analytics.

The seven lines are stored separately in [`voiceover/`](voiceover/) (`vo1.wav` … `vo7.wav`) so they can be re-timed or re-recorded independently.

## Regenerating / editing the video

Everything is generated from code — no video editor required.

```bash
cd marketing/video-src
npm install            # @resvg/resvg-js, pngjs
node render.js         # re-renders every frame and encodes the MP4
node probe.js 5.6 9.6  # dump single frames as PNG for a quick look
node vo.js             # rebuild the voice-over/music mix (needs ffmpeg with atempo)
node audio.js          # rebuild just the music + SFX bed
```

| File | Purpose |
|---|---|
| `core.js` | Canvas constants, brand colours, easing, SVG helpers, TTF text measurement |
| `ui.js` | The POS screen mock-up (faithful to the app), device frames, icons, receipt, logo |
| `scenes.js` | The seven scenes, the timeline (`TL`) and every animation |
| `audio.js` | Synthesised music bed + SFX (kick/clap/hats, bass, arps, cha-ching, whooshes) |
| `vo.js` | De-silences and paces the voice-over, then mixes it under the music with ducking |
| `render.js` | Renders all 592 frames with resvg and pipes raw RGBA into ffmpeg (libx264 + AAC) |
| `probe.js` / `qa.js` | Dump individual frames as PNG (before / after encoding) |

The timeline in `scenes.js` (`TL`) is the single source of truth — scene cuts, on-screen labels and the voice-over placement all read from it.

## Poster frames

- `poster-cta.png` — closing frame (use as the end-card / thumbnail)
- `poster-desktop.png` — the desktop POS hero frame
- `poster-logo.png` — circular brand lockup (opening badge)
