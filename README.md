# Logos — Bilingual Bible Reader (English ESV · 한국어 개역한글)

A lean, distraction-free bilingual Bible web app for reading and listening to Scripture side-by-side while learning Korean.

## Features

- **Home Page & Passage Search**: Clean Home view (`#/`) with **Continue Reading**, bilingual passage search (`John 3:16`, `요 3:16`, `시 23`), featured chapters, and a full OT/NT browser. Clicking **Logos** in the top left returns Home.
- **Bundled Canonical Editions**: Displays **English (`ESV`)** and **Korean (`개역한글` KRV 1961)** bundled locally, with a **1-click `EN / 한` flip button** in the top bar.
- **3-Column Reading Workspace**:
  - **Left Margin**: Sticky **Audio & Verse Sync** controls (Play/Pause, `한` / `EN` audio toggle, speed, scrubber, Standard/Drama tracks, and two-way visible-verse auto-sync).
  - **Center**: Stacked verse pairs with hover/tap Korean word definitions and verse deep-links (`#/JHN/3/16`).
  - **Right Margin**: Sticky **Korean Dictionary & KRV Grammar Guide** (`어휘`) synced to chapter vocabulary.
- **Bible Brain v4 Audio & Multi-Language Endpoints**: Uses [Bible Brain API v4](https://4.dbt.io/open-api-4.json) (`BIBLE_BRAIN_API_KEY`) as primary provider for standard/dramatized MP3 audio and `/timestamps` verse sync—falling back to Crossway ESV (`ESV_API_KEY`) and zero-key Korean narration—plus future-ready Worker endpoints:
  - `GET /api/languages` — lists available Bible Brain languages (`limit`/`page` supported)
  - `GET /api/passage/:target/:usfm/:chapter` — resolves `lang:<iso>` (`text_plain` preferred) or `bb:<filesetId>` chapters
  - `GET /api/audio/:usfm/:chapter` — resolves canonical `ko`/`en` audio + timestamps and optional `?lang=<iso>&bible=<abbr>` tracks
- **Editorial Reader Controls**: Paper, Sepia, and Dark themes; text scaling; Serif (명조) vs. Sans (고딕) Korean typefaces; and blur-to-study self-test mode.
- **Hardened Worker & Assets**: HTTPS-only upstream/custom media validation, 6s upstream timeouts, strict input/method checks, and CSP/security headers (`public/_headers` + Worker middleware).

## Commands (Pure Bun)

```bash
bun install          # Install dependencies
bun run dev          # Start Vite + Cloudflare Worker dev server
bun run check        # Run Bun formatter check + native Bun TypeScript check
bun run format       # Format codebase with bun fmt
bun test             # Run unit, Worker API, and happy-dom React tests via Bun
bun run build        # Typecheck with bun check and build Worker + client bundle
bun run data:build   # Rebuild bundled ESV/KRV chapters and compact Korean lexicon
```

## Optional Audio Configuration

Copy `.dev.vars.example` to `.dev.vars` (gitignored; kept server-side in Worker bindings):

```env
BIBLE_BRAIN_API_KEY=your_bible_brain_key
ESV_API_KEY=your_free_esv_key
AUDIO_BASE_URL=https://cdn.example.com/audio/krv
```
