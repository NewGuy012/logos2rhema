# Logos — Bilingual Bible Reader (English ESV · 한국어 개역한글)

A minimal, distraction-free bilingual Bible web app for reading Scripture side-by-side in stacked verse pairs while learning Korean.

## Features

- **Stacked Bilingual Reading**: Displays **English (ESV)** above **Korean (개역한글 KRV 1961)** by default, with a **1-click `EN / 한` flip button** in the top bar.
- **Selectable Translations + Synced Human Audio**: Switch between English (`ESV`, `BSB`, `KJV`, `WEB`, `ASV`) and Korean (`개역한글 KRV`, `한글1910`), or connect a free [Bible Brain API](https://4.dbt.io/api_key/request) key in `.dev.vars` to unlock additional translations and verse-level timestamps. Audio playback uses real human recordings (never synthetic TTS) and automatically syncs when translations change.
- **Korean Hover Tooltips**: Hover (or tap on mobile) any Korean word to view its English translation, dictionary root (`lemma`), Hanja (when applicable), and particle/ending breakdown.
- **Chapter Footnotes Vocabulary & Grammar Guide**: Every chapter includes a deduplicated Korean-to-English word list ordered by appearance plus an explanatory guide to 1961 개역한글 archaic endings (`~하시니라`, `가라사대`, `~하매`, `~할지니라`).
- **Editorial Reader Controls**: Paper, Sepia, and Dark themes; text scaling; Serif (명조) vs. Sans (고딕) Korean typefaces; and blur-to-study self-test mode.

## Commands (Bun + Biome)

```bash
bun install          # Install dependencies
bun run dev          # Start Vite + Cloudflare Worker dev server
bun run check        # Run Biome lint/format check + TypeScript typecheck
bun run format       # Format codebase with Biome
bun test             # Run unit, API, and component tests via Bun
bun run build        # Typecheck and build Worker + client bundle
bun run data:build   # Rebuild bundled ESV/KRV chapters and compact Korean lexicon
```

## Optional Audio Configuration

Copy `.dev.vars.example` to `.dev.vars` if you want to enable Bible Brain translations/timestamps or point `개역한글` to your own hosted/R2 MP3 files:

```env
BIBLE_BRAIN_API_KEY=your_free_key
AUDIO_BASE_URL=https://cdn.example.com/audio/krv
```
