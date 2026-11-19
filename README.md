<div align="center">

# Logos2Rhema

**Bilingual Bible reader (`ESV` · `개역한글`) for reading, listening, and learning Korean side-by-side.**

### [Open Live App → logos2rhema.juyoung-m-yoo.workers.dev](https://logos2rhema.juyoung-m-yoo.workers.dev/)

[![Live App](https://img.shields.io/badge/Live_App-Cloudflare_Workers-8b5a3c?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://logos2rhema.juyoung-m-yoo.workers.dev/)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4-e36002?style=flat-square&logo=hono&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime_%26_test-000000?style=flat-square&logo=bun&logoColor=white)

</div>

---

## Features

- **Side-by-Side Scripture** — Read bundled English (**ESV**) and Korean (**개역한글**, KRV 1961) stacked verse by verse, flip stack order (`EN / 한` ↔ `한 / EN`), and practice recall with hover-to-reveal **Study Mode** blur.
- **Instant Korean Dictionary & Grammar** — Hover or tap any Korean word for morphological analysis, **Revised Romanization**, **Web Speech (`ko-KR`)** pronunciation, and a chapter-synced **Words & Grammar** panel.
- **Verse-Synced Audio** — Listen to **Supertonic 3 (`Daniel`)** Korean narration synced verse by verse (two-way scroll follow, preset and custom `0.1x–2.0x` playback speed, `±10s` skip) alongside **Crossway ESV** English audio.
- **Integrated Commentary** — Switch between **Tyndale Open Study Notes** and **Matthew Henry Commentary** synced to your active verse, with keyword/verse search and book/chapter introductions.
- **Fast Navigation & Personalization** — Jump via bilingual references (`John 3:16`, `요 3:16`, `시 23`), browse **Scripture**, **Genres**, **Audio**, **Dictionary**, and **Commentary** directly from Home, save **Bookmarks** and **Highlights**, drag and snap back desktop side rails, and choose Paper, Sepia, or Dark themes, English (`Newsreader` / `Lora` / `Inter`) and Korean (`Serif` / `Sans`) fonts, and `S`–`XL` text scaling.

## Keyboard Shortcuts

| Shortcut        | Action                                                          |
| :-------------- | :-------------------------------------------------------------- |
| `⌘K` / `Ctrl+K` | Open or close the passage quick-jump modal                      |
| `⌘H` / `Ctrl+H` | Highlight or remove highlight on selected verse text            |
| `←` / `→`       | Skip audio `±10s` while playing, or switch chapters when paused |

## Tech Stack

| Layer                  | Technology                                                                                                                                                                               |
| :--------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**           | [React 19](https://react.dev/), custom editorial CSS (`Paper` / `Sepia` / `Dark`)                                                                                                        |
| **Edge API**           | [Hono](https://hono.dev/) on [Cloudflare Workers](https://workers.cloudflare.com/)                                                                                                       |
| **Language & Tooling** | [TypeScript](https://www.typescriptlang.org/), [Bun](https://bun.sh/) (`bun build`, `bun test`, `bun fmt`, `bun check`), [Wrangler](https://developers.cloudflare.com/workers/wrangler/) |
| **Data & Audio**       | Bundled ESV/KRV JSON & Korean lexicon (`public/data/`), [HelloAO](https://bible.helloao.org/) commentaries, Crossway ESV & Supertonic 3 audio                                            |

## Quick Start

```bash
bun install
bun run dev
```

Bundled Scripture text, Korean lexicon, and HelloAO commentaries work out of the box with zero configuration.

### Scripts

| Command                      | Description                                                                   |
| :--------------------------- | :---------------------------------------------------------------------------- |
| `bun run dev`                | Start Bun dev server with HMR + local Hono API (binds `127.0.0.1` by default) |
| `bun test`                   | Run unit, Worker API, and `happy-dom` React tests                             |
| `bun run check`              | Run `bun fmt --check` and native `bun check` typechecking                     |
| `bun run format`             | Format codebase with `bun fmt`                                                |
| `bun run build`              | Typecheck and build client SPA bundle into `dist/client/`                     |
| `bun run deploy`             | Deploy to Cloudflare Workers via Wrangler                                     |
| `bun run data:build`         | Rebuild bundled ESV/KRV chapters and Korean lexicon                           |
| `bun run audio:generate-krv` | Generate Supertonic 3 KRV audio and verse timings                             |
| `bun run audio:upload-krv`   | Upload local KRV MP3s to private Cloudflare R2 via Wrangler                   |

## API Endpoints

All Worker routes enforce `GET`/`HEAD`-only access, HSTS and strict CSP/security headers, HTTPS upstream validation, upstream redirect/size limits on commentary fetches, and `no-store` error boundaries.

| Endpoint                                           | Purpose                                                                 |
| :------------------------------------------------- | :---------------------------------------------------------------------- |
| `GET /api/audio/:usfm/:chapter`                    | Resolve Korean (Supertonic 3) and English (Crossway ESV) chapter tracks |
| `GET /api/audio/krv/:usfm/:chapter`                | Stream Korean Supertonic 3 chapter MP3 from private R2 (`Range` + ETag) |
| `GET /api/audio/esv/:usfm/:chapter`                | Proxy or redirect Crossway ESV chapter audio                            |
| `GET /api/commentary/:commentaryId/:usfm/:chapter` | Normalized chapter commentary & introductions from `bible.helloao.org`  |

<details>
<summary><strong>Optional: Configure ESV &amp; Supertonic 3 Korean Audio</strong></summary>

1. _(Optional)_ Generate Supertonic 3 (`Daniel`) Korean MP3s and verse timings locally (requires [`uv`](https://docs.astral.sh/uv/)):

   ```bash
   bun run audio:generate-krv --dry-run
   caffeinate -i bun run audio:generate-krv --testament NT --voice Daniel --speed 0.95 --steps 10
   caffeinate -i bun run audio:generate-krv --testament OT --voice Daniel --speed 0.95 --steps 10
   ```

   When `.cache/krv-supertonic-audio/` exists locally (and `AUDIO_BASE_URL` is unset), `bun run dev` and `bun run preview` serve chapters directly from disk via `GET /api/audio/krv/:usfm/:chapter`.

2. Upload `.cache/krv-supertonic-audio/{USFM}/{CHAPTER}.mp3` to your private R2 bucket (`logos-krv-audio`, `Public Access: Disabled`, bound as `AUDIO_BUCKET` in `wrangler.json`):

   ```bash
   bunx wrangler login
   bun run audio:upload-krv --dry-run
   caffeinate -i bun run audio:upload-krv
   ```

3. Copy `.dev.vars.example` to `.dev.vars` (gitignored) if you want Crossway ESV English audio locally, or use `AUDIO_BASE_URL` only as an optional external-CDN fallback when `AUDIO_BUCKET` is unbound:

   ```env
   ESV_API_KEY=your_free_esv_key
   # AUDIO_BASE_URL=https://your-cdn.example.com
   ```

</details>
