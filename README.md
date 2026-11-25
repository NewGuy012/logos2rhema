<div align="center">

# Logos2Rhema

**Bilingual Bible reader (`ESV` · `개역한글`) for reading, listening, and learning Korean side-by-side.**

### [Open Live App → logos2rhema.juyoung-m-yoo.workers.dev](https://logos2rhema.juyoung-m-yoo.workers.dev/)

[![Live App](https://img.shields.io/badge/Live_App-Cloudflare_Workers-8b5a3c?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://logos2rhema.juyoung-m-yoo.workers.dev/)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime_%26_test-000000?style=flat-square&logo=bun&logoColor=white)

</div>

---

## Features

- **Side-by-Side Scripture** — Read English (**ESV®** via Crossway's live ESV API) and bundled Korean (**개역한글**, KRV 1961) stacked verse by verse, flip stack order (`EN / 한` ↔ `한 / EN`), and practice recall with hover-to-reveal **Study Mode** blur.
- **Instant Korean Dictionary & Grammar** — Hover or tap any Korean word for morphological analysis, **Revised Romanization**, **Web Speech (`ko-KR`)** pronunciation, and a chapter-synced **Words & Grammar** panel.
- **Verse-Synced Audio** — Listen to **Supertonic 3 (`Daniel`)** AI-generated Korean narration (`개역한글 · AI 낭독`) synced verse by verse (two-way scroll follow, preset and custom `0.1x–2.0x` playback speed, `±10s` skip) alongside **Crossway ESV** English audio.
- **Integrated Commentary** — Switch between **Tyndale Open Study Notes** and **Matthew Henry Commentary** synced to your active verse, with keyword/verse search and book/chapter introductions.
- **Fast Navigation & Personalization** — Jump via bilingual references (`John 3:16`, `요 3:16`, `시 23`), browse **Scripture**, **Genres**, **Audio**, **Dictionary**, and **Commentary** directly from Home, save **Bookmarks** and **Highlights**, drag and snap back desktop side rails, and choose Paper, Sepia, or Dark themes, system English and Korean (`Serif` / `Sans`) fonts, and `S`–`XL` text scaling.

## Keyboard Shortcuts

| Shortcut        | Action                                                          |
| :-------------- | :-------------------------------------------------------------- |
| `⌘K` / `Ctrl+K` | Open or close the passage quick-jump modal                      |
| `⌘H` / `Ctrl+H` | Highlight or remove highlight on selected verse text            |
| `←` / `→`       | Skip audio `±10s` while playing, or switch chapters when paused |

## Tech Stack

| Layer                  | Technology                                                                                                                                                                                   |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**           | [React 19](https://react.dev/), custom editorial CSS (`Paper` / `Sepia` / `Dark`)                                                                                                            |
| **Edge API**           | [Cloudflare Workers](https://workers.cloudflare.com/) (Web Fetch API)                                                                                                                        |
| **Language & Tooling** | [TypeScript](https://www.typescriptlang.org/), [Bun](https://bun.sh/) (`bun build`, `bun test`, `bun fmt`, `bun check`), [Wrangler](https://developers.cloudflare.com/workers/wrangler/)     |
| **Data & Audio**       | Bundled KRV 1961 JSON & Korean lexicon (`public/data/`), live [ESV API](https://api.esv.org/) text & audio, [HelloAO](https://bible.helloao.org/) commentaries, Supertonic 3 AI Korean audio |

## Quick Start

```bash
bun install
cp .dev.vars.example .dev.vars   # add your free ESV_API_KEY from api.esv.org
bun run dev
```

Bundled Korean Scripture (`public/data/bibles/krv/`), Korean lexicon, and HelloAO commentaries work out of the box; English ESV text and audio stream live from Crossway's API using `ESV_API_KEY` (or from gitignored `.cache/esv-local/` in local `bun run dev` when `data-sources/esv.spb` is present and `USE_LIVE_ESV` is unset).

### Scripts

| Command                             | Description                                                                                                                                                        |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`                       | Start Bun dev server with HMR + local Worker API (binds `127.0.0.1` by default; `process.env` overrides `.dev.vars`; pass `USE_LIVE_ESV=1` for live `api.esv.org`) |
| `bun test`                          | Run unit, Worker API, and `happy-dom` React tests                                                                                                                  |
| `bun run check`                     | Run `bun fmt --check` and native `bun check` typechecking                                                                                                          |
| `bun run format`                    | Format codebase with `bun fmt`                                                                                                                                     |
| `bun run build`                     | Typecheck and build client SPA bundle into `dist/client/` (fails if static ESV files exist)                                                                        |
| `bun run deploy`                    | Deploy to Cloudflare Workers via Wrangler                                                                                                                          |
| `bun run data:build`                | Rebuild bundled KRV chapters and Korean lexicon (and optional local-only `.cache/esv-local/` if `data-sources/esv.spb` exists)                                     |
| `bun run audio:generate-krv`        | Generate Supertonic 3 KRV audio and verse timings locally (multi-core CPU) or on Thunder Compute (`--create` / `--thunder`)                                        |
| `bun run audio:generate-krv:remote` | Offload Supertonic 3 KRV generation to Thunder Compute using `THUNDER_INSTANCE` or a single running `tnr` instance                                                 |
| `bun run audio:upload-krv`          | Upload local KRV MP3s to private Cloudflare R2 via Wrangler                                                                                                        |

## API Endpoints

All Worker routes enforce `GET`/`HEAD`-only access, HSTS, COOP, CORP (`same-origin`), and strict CSP/security headers, HTTPS upstream validation, upstream redirect/size limits, and sanitized `no-store` error boundaries.

| Endpoint                                           | Purpose                                                                                                                                                      |
| :------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/esv/:usfm/:chapter`                      | Fetch live ESV chapter text from `api.esv.org` (`Cache-Control: private, no-store`; uses local `.cache/esv-local/` in `bun run dev` unless `USE_LIVE_ESV=1`) |
| `GET /api/audio/:usfm/:chapter`                    | Resolve Korean (Supertonic 3 AI narration) and English (Crossway ESV) chapter tracks                                                                         |
| `GET /api/audio/krv/:usfm/:chapter`                | Stream Korean Supertonic 3 AI narration MP3 from private R2 (`Range` + ETag)                                                                                 |
| `GET /api/audio/esv/:usfm/:chapter`                | Proxy or redirect Crossway ESV chapter audio                                                                                                                 |
| `GET /api/commentary/:commentaryId/:usfm/:chapter` | Normalized chapter commentary & introductions from `bible.helloao.org`                                                                                       |

<details>
<summary><strong>Configure Live ESV API &amp; Supertonic 3 Korean Audio</strong></summary>

1. Configure your free non-commercial Crossway ESV API key ([api.esv.org](https://api.esv.org/)) for both ESV text (`GET /api/esv/:usfm/:chapter`) and English audio:

   - **Local dev (`.dev.vars`, gitignored):** Copy `.dev.vars.example` to `.dev.vars` and set `ESV_API_KEY=your_free_esv_key`. To verify live Crossway responses locally even when `.cache/esv-local/` exists, run `USE_LIVE_ESV=1 bun run dev`.
   - **Production (Cloudflare Workers):** Upload the secret via Wrangler before deploying:

     ```bash
     bunx wrangler secret put ESV_API_KEY
     ```

   _(Optional private dev cache)_: If you keep a personal `data-sources/esv.spb` locally (gitignored), `bun run data:build` writes `.cache/esv-local/{USFM}.json` (gitignored, never bundled into `dist/client/`) for fast offline local `bun run dev`.

2. _(Optional)_ Generate Supertonic 3 (`Daniel`, AI TTS) Korean MP3s and verse timings locally via multi-core CPU (requires [`uv`](https://docs.astral.sh/uv/)), or offload to **Thunder Compute (`1× RTX A6000`)** via the `tnr` CLI:

   ```bash
   # Local dry-run / multi-core CPU generation (free; defaults tuned to q=5)
   bun run audio:generate-krv --dry-run
   caffeinate -i bun run audio:generate-krv --testament NT

   # Isolated 4-chapter RUT test on Thunder (auto 1x A6000, q=5, auto-deleted; prod & R2 untouched)
   bun run audio:generate-krv --create --book RUT --staging rut-test --force --dry-run
   bun run audio:generate-krv --create --book RUT --staging rut-test --force

   # Whole Bible — zero-config matrix sweet spot (auto 4x 1x A6000 VMs, q=5, ~12-15 min, ~$0.30-$0.35, auto-deleted)
   bun run audio:generate-krv --create --all --dry-run
   bun run audio:generate-krv --create --all

   # Fastest low-cost whole Bible (8x 1x A6000 VMs, q=5, ~8-10 min, ~$0.40-$0.50, auto-deleted)
   bun run audio:generate-krv --create --shards 8 --all

   # Reuse an existing VM (kept running unless --delete-after is passed; use --keep-vms with --create to keep fresh VMs)
   bun run audio:generate-krv --thunder 0 --books GEN,EXO --force
   ```

   Thunder runs provision `1× RTX A6000` (`8 vCPUs`, `prototyping`, `cuda12-8`, `100 GB` disk) VMs via `tnr`, cache `.venv` (CUDA `onnxruntime-gpu`) and Supertonic 3 weights on the VM, auto-size parallel shards (`1` for `<=25` ch, `2` for `26–150` ch, `4` for `>150` ch, overrideable up to `--shards 8`), run pipelined multi-vCPU MP3 encoding (`--mp3-quality 5` default), and automatically delete newly created VMs after clean sync (pass `--keep-vms` to keep them, or use `tnr connect <id>` for a shell). R2 uploads are always separate via `bun run audio:upload-krv`.

   When `.cache/krv-supertonic-audio/` exists locally (and `AUDIO_BASE_URL` is unset), `bun run dev` and `bun run preview` serve chapters directly from disk via `GET /api/audio/krv/:usfm/:chapter`.

3. Upload `.cache/krv-supertonic-audio/{USFM}/{CHAPTER}.mp3` to your private R2 bucket (`logos-krv-audio`, `Public Access: Disabled`, bound as `AUDIO_BUCKET` in `wrangler.json`):

   ```bash
   bunx wrangler login
   bun run audio:upload-krv --dry-run
   bun run audio:upload-krv --books RUT,PHM
   caffeinate -i bun run audio:upload-krv
   ```

4. Optionally set `AUDIO_BASE_URL` in `.dev.vars` only as an external-CDN fallback when `AUDIO_BUCKET` is unbound:

   ```env
   ESV_API_KEY=your_free_esv_key
   # AUDIO_BASE_URL=https://your-cdn.example.com
   ```

</details>

## Licensing & Attribution

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full details, upstream links, and build-time modifications:

- **성경전서 개역한글판 (KRV 1961)** (`public/data/bibles/krv/`) — Attributed to **대한성서공회** (Korean Bible Society). Economic rights (저작재산권) expired in South Korea on December 31, 2011; moral rights (성명표시권 · 동일성유지권) are respected via attribution and verbatim text rendering. _(Note: U.S. URAA restoration rules under 17 U.S.C. § 104A may technically apply to foreign works protected in 1996.)_
- **Supertonic 3 AI Audio** (`logos-krv-audio` R2 & `public/data/timings/krv-supertonic/`) — Synthesized with **Supertonic 3** by Supertone (runtime/SDK: **MIT**; model weights: **BigScience OpenRAIL-M**). Clearly disclosed as AI-generated narration (`개역한글 · AI 낭독`) across API responses, audio players, and page footers.
- **Crossway ESV® Text & Audio** — Streamed live under Crossway's non-commercial ESV API terms with bounded in-memory caching and attribution (`ESV.org`).
- **Commentaries (HelloAO)** — **Tyndale Open Study Notes** (CC BY-SA 4.0) and **Matthew Henry's Complete Commentary** (Public Domain).
- **Bundled Korean Lexicon** (`public/data/lexicon.json`) — Compiled from **KRDICT** (국립국어원, CC BY-SA 2.0 KR), **Korean Wiktionary via Kaikki.org** (CC BY-SA 4.0 / GFDL), and **Kengdic** (MPL 2.0 / LGPL 2.0+).
