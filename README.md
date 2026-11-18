# Logos — Bilingual Bible Reader (English ESV · 한국어 개역한글)

A minimal, distraction-free bilingual Bible web app for reading and listening to Scripture side-by-side while learning Korean.

## Features

- **Home Page & Instant Passage Navigation**: Opens on a clean Home view (`#/`) with **Continue Reading**, bilingual passage search (`John 3:16`, `요 3:16`, `시 23`), featured chapters, and a full OT/NT browser. Clicking the **Logos** logo in the top left always returns Home.
- **One Canonical Bible Per Language**: Displays **English (`ESV`)** and **Korean (`개역한글` KRV 1961)** bundled locally, with a **1-click `EN / 한` flip button** in the top bar.
- **3-Column Reading Workspace**:
  - **Left Margin**: Sticky **Audio & Verse Sync** controls (Play/Pause, `한` / `EN` audio toggle, speed, scrubber, Standard/Drama tracks, and two-way visible-verse auto-sync).
  - **Center**: Distraction-free stacked verse pairs with hover/tap Korean word definitions.
  - **Right Margin**: Sticky **Korean Dictionary & KRV Grammar Guide** (`어휘`) synced to chapter vocabulary.
- **Bible Brain v4 Primary Audio & Multilingual Future-Proofing**: Uses [Bible Brain API v4](https://4.dbt.io/open-api-4.json) (`BIBLE_BRAIN_API_KEY`) as primary provider for multi-language expansion, standard/dramatized audio, and `/timestamps` verse-level sync—falling back seamlessly to Crossway ESV (`ESV_API_KEY`) and zero-key Korean narration.
- **Editorial Reader Controls**: Paper, Sepia, and Dark themes; text scaling; Serif (명조) vs. Sans (고딕) Korean typefaces; and blur-to-study self-test mode.

## Commands (Pure Bun)

```bash
bun install          # Install dependencies
bun run dev          # Start Vite + Cloudflare Worker dev server
bun run check        # Run Bun formatter check + native Bun TypeScript check
bun run format       # Format codebase with bun fmt
bun test             # Run unit, API, and component tests via Bun
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
