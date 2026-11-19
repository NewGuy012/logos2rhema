# Logos2Rhema — Bilingual Bible Reader (English ESV · 한국어 개역한글)

A lean, distraction-free bilingual Bible web app for reading and listening to Scripture side-by-side while learning Korean.

## Features

- **Home & Navigation**: Clean Home view (`#/`) with **Continue Where You Left Off**, collapsible **Favorites** (Bookmarks & Highlights), collapsible **Browse Genres**, bilingual passage search (`John 3:16`, `요 3:16`, `시 23`), and a full OT/NT browser. Quick-jump modal (`⌘K` / `Ctrl+K`) and TopBar **Favorites** / **Genres** popovers are accessible everywhere.
- **Bundled Canonical Editions**: Displays **English (`ESV`)** and **Korean (`개역한글` KRV 1961)** bundled locally under `public/data/`, with a **Stack Order** toggle (`EN / 한` vs. `한 / EN`) in Display settings.
- **3-Column Desktop Workspace**:
  - **Left Rail**: Collapsible sticky **Audio & Verse Sync** player (Play/Pause, `한` / `EN` toggle, scrubber, 10s skip, speed menu, and two-way visible-verse auto-sync with scroll pause/follow recovery).
  - **Center**: Stacked verse pairs with verse deep-links (`#/JHN/3/16`), verse/chapter **Bookmarks**, text **Highlights** (`⌘H` / `Ctrl+H` or floating toolbar), and interactive Korean word tooltips with **Revised Romanization**, **Web Speech (`ko-KR`) pronunciation**, and **View in Dictionary**.
  - **Right Rail (Tabbed)**: Collapsible sticky panel with **Dictionary** (**Korean Dictionary & KRV Grammar Guide** synced to chapter vocabulary with search and pronunciation playback) and **Commentary** (**Tyndale Open Study Notes** & **Matthew Henry Bible Commentary** synced to verse selection with keyword/verse search and book/chapter introductions).
- **Audio & Commentary Worker Endpoints**: Serves **Supertonic 3 (`Daniel`)** verse-synced Korean KRV audio from Cloudflare R2 (`AUDIO_BASE_URL`, falling back temporarily to Wordproject Korean narration), Crossway **ESV** chapter audio (`ESV_API_KEY`), and keyless HelloAO commentaries:
  - `GET /api/config` — returns canonical translation metadata and audio capability flags
  - `GET /api/audio/:usfm/:chapter` — resolves `ko` (Supertonic 3 / Wordproject fallback) and `en` (Crossway ESV) chapter audio tracks
  - `GET /api/audio/esv/:usfm/:chapter` — proxies/redirects Crossway ESV audio when `ESV_API_KEY` is configured
  - `GET /api/commentaries` — returns curated English commentary metadata (`tyndale`, `matthew-henry`)
  - `GET /api/commentary/:commentaryId/:usfm/:chapter` — proxies and normalizes chapter commentary from `bible.helloao.org`
- **Editorial Display Controls**: Paper, Sepia, and Dark themes; text scaling (`S`–`XL`); Serif (명조) vs. Sans (고딕) Korean typefaces; Stack Order; and hover-to-reveal **Study Mode** blur.
- **Hardened Worker & Assets**: HTTPS-only upstream/media validation with SSRF/IP/port/key-leak guards, upstream timeouts, safe JSON parsing, `502` / `no-store` error boundaries, prototype-safe dictionary lookups, and strict CSP/security headers (`public/_headers` + Worker middleware).

## Commands (Bun)

```bash
bun install             # Install dependencies
bun run dev             # Start Vite + Cloudflare Worker dev server
bun run check           # Run Bun formatter check + native Bun TypeScript check
bun run format          # Format codebase with bun fmt
bun test                # Run unit, Worker API, and happy-dom React tests via Bun
bun run build           # Typecheck with bun check and build Worker + client bundle
bun run data:build      # Rebuild bundled ESV/KRV chapters and compact Korean lexicon
bun run audio:generate-krv  # Generate Supertonic 3 KRV MP3s (.cache) + exact verse timings
```

## Optional Audio Configuration

Copy `.dev.vars.example` to `.dev.vars` (gitignored; kept server-side in Worker bindings):

```env
AUDIO_BASE_URL=https://your-r2-domain.example.com
ESV_API_KEY=your_free_esv_key
```

To generate and deploy the Supertonic 3 (`Daniel` / `M5`) Korean audio locally (requires [`uv`](https://docs.astral.sh/uv/)):

```bash
bun run audio:generate-krv --dry-run
caffeinate -i bun run audio:generate-krv --testament NT --voice Daniel --speed 0.95 --steps 10
caffeinate -i bun run audio:generate-krv --testament OT --voice Daniel --speed 0.95 --steps 10
```

Upload `.cache/krv-supertonic-audio/{USFM}/{CHAPTER}.mp3` to your Cloudflare R2 bucket with `Cache-Control: public, max-age=31536000, immutable` and set `AUDIO_BASE_URL` in `.dev.vars` and your Cloudflare Worker bindings.
