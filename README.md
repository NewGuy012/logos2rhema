# Logos2Rhema — Bilingual Bible Reader (English ESV · 한국어 개역한글)

A lean, distraction-free bilingual Bible web app for reading and listening to Scripture side-by-side while learning Korean.

## Features

- **Home & Navigation**: Clean Home view (`#/`) with **Continue Where You Left Off**, collapsible **Favorites** (Bookmarks & Highlights), collapsible **Browse Genres**, bilingual passage search (`John 3:16`, `요 3:16`, `시 23`), and a full OT/NT browser. Quick-jump modal (`⌘K` / `Ctrl+K`) and TopBar **Favorites** / **Genres** popovers are accessible everywhere.
- **Bundled Canonical Editions**: Displays **English (`ESV`)** and **Korean (`개역한글` KRV 1961)** bundled locally under `public/data/`, with a **Stack Order** toggle (`EN / 한` vs. `한 / EN`) in Display settings.
- **3-Column Desktop Workspace**:
  - **Left Rail**: Collapsible sticky **Audio & Verse Sync** player (Play/Pause, `한` / `EN` toggle, scrubber, 10s skip, speed menu, Standard/Drama tracks, and two-way visible-verse auto-sync).
  - **Center**: Stacked verse pairs with verse deep-links (`#/JHN/3/16`), verse/chapter **Bookmarks**, text **Highlights** (`⌘H` / `Ctrl+H` or floating toolbar), and interactive Korean word tooltips with **Revised Romanization**, **Web Speech (`ko-KR`) pronunciation**, and **View in Dictionary**.
  - **Right Rail**: Collapsible sticky **Korean Dictionary & KRV Grammar Guide** (`어휘`) synced to chapter vocabulary with search and pronunciation playback.
- **Bible Brain v4 Audio & Multi-Language Endpoints**: Uses [Bible Brain API v4](https://4.dbt.io/open-api-4.json) (`BIBLE_BRAIN_API_KEY`) as primary provider for standard/dramatized MP3 audio and `/timestamps` verse sync—falling back to Crossway ESV (`ESV_API_KEY`) and zero-key Wordproject Korean narration—plus future-ready Worker endpoints:
  - `GET /api/languages` — lists available Bible Brain languages (`limit`/`page` supported)
  - `GET /api/passage/:target/:usfm/:chapter` — resolves `lang:<iso>` (`text_plain` preferred) or `bb:<filesetId>` chapters
  - `GET /api/audio/:usfm/:chapter` — resolves canonical `ko`/`en` audio + timestamps and optional `?lang=<iso>&bible=<abbr>` tracks
- **Editorial Display Controls**: Paper, Sepia, and Dark themes; text scaling (`S`–`XL`); Serif (명조) vs. Sans (고딕) Korean typefaces; Stack Order; and hover-to-reveal **Study Mode** blur.
- **Hardened Worker & Assets**: HTTPS-only upstream/media validation with SSRF/IP/port/key-leak guards, upstream timeouts, safe JSON parsing, `502` / `no-store` error boundaries, prototype-safe dictionary lookups, and strict CSP/security headers (`public/_headers` + Worker middleware).

## Commands (Bun)

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
