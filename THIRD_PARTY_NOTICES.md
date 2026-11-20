# Third-Party Notices & Licensing

This repository bundles or integrates third-party scripture texts, AI speech models/outputs, commentaries, and lexical datasets. Each component remains subject to its respective rights and license terms below.

---

## 1. Korean Scripture — 성경전서 개역한글판 (KRV 1961)

- **Location:** `public/data/bibles/krv/` (66 canonical book JSON files)
- **Attribution (성명표시권):** 대한성서공회 (Korean Bible Society)
- **Upstream Dataset:** [`bluesaurel/Korean-Bible-1961-KRV`](https://github.com/bluesaurel/Korean-Bible-1961-KRV) (pinned commit `2fdb91e77d323b99bacaa9b61fc18f318b703240` in `scripts/build-bible-data.ts`)
- **Copyright & Moral Rights Notes:**
  - **South Korea:** The Korean Bible Society officially recognizes that economic rights (저작재산권) in _성경전서 개역한글판 (1961)_ expired on **December 31, 2011**.
  - **Moral Rights (저작인격권):** Attribution to 대한성서공회 (성명표시권) and textual integrity (동일성유지권) still apply. Displayed verse text in `public/data/bibles/krv/` is preserved verbatim (aside from whitespace normalization during JSON ingestion) and rendered unaltered in the UI.
  - **U.S. URAA Technicality (17 U.S.C. § 104A):** Because KRV 1961 was still protected in South Korea on January 1, 1996, under U.S. Uruguay Round Agreements Act (URAA) restoration rules a foreign work can technically still be treated as copyrighted in the United States even after expiring in its source country. Operators deploying or hosting commercially in the U.S. should evaluate this independently or contact the Korean Bible Society.

---

## 2. Korean AI Narration — Supertonic 3 TTS Audio & Verse Timings

- **Location:** Private Cloudflare R2 bucket `logos-krv-audio` (`{USFM}/{CHAPTER}.mp3`), verse timing maps in `public/data/timings/krv-supertonic/`, and generator script `scripts/generate-krv-audio.py`
- **Model & Creator:** `supertonic-3` (voice `Daniel` / `M5`) by **Supertone Inc.**
  - Source / SDK repository: [`supertone-inc/supertonic`](https://github.com/supertone-inc/supertonic)
  - Model weights: [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3)
- **Licenses:**
  - **Runtime & SDK code:** MIT License
  - **Model weights (`supertonic-3`):** [BigScience OpenRAIL-M License](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE) ([canonical OpenRAIL-M reference](https://huggingface.co/spaces/bigscience/license))
- **Compliance Measures in This Repo:**
  - **AI-speech disclosure:** API responses (`/api/audio/:usfm/:chapter`), audio player controls (`AudioControlRail`, `FloatingBottomBar`, `HomeAudioBrowser`), and site footers (`LegalFooter`) clearly identify Korean chapter audio as AI-generated narration (`개역한글 · AI 낭독 (Supertonic 3)` / `AI 낭독 · Supertonic 3`).
  - **Use-based restrictions:** Redistributors and operators must adhere to the use-based restrictions in BigScience OpenRAIL-M (including prohibitions against harmful/unlawful use or deceptive impersonation).
  - **Text integrity:** Speech-synthesis normalization in `scripts/generate-krv-audio.py` (`normalize_krv_text`) only adjusts punctuation, parentheticals, and `(셀라)` notation for TTS pronunciation; it never modifies the displayed KRV 1961 text.

---

## 3. English Scripture & Audio — Crossway ESV®

- **Access:** Proxied live at runtime from the [Crossway ESV API](https://api.esv.org/) via `/api/esv/:usfm/:chapter` and `/api/audio/esv/:usfm/:chapter` (`src/worker/esv-text.ts`, `src/worker/esv-audio.ts`)
- **Attribution:**
  > Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. ESV Text Edition: 2025. Used by permission. All rights reserved. ([ESV.org](https://www.esv.org))
- **Compliance Measures in This Repo:**
  - No static ESV text or audio files are committed or bundled in `dist/client/` (`scripts/build-client.ts` refuses to build if `public/data/bibles/esv/` exists).
  - `/api/esv/:usfm/:chapter` responds with `Cache-Control: private, no-store`, and client memory caching is capped at `<= 400` verses total and `<= 1/2` of any multi-chapter book (`src/react-app/lib/bible-loader.ts`).
  - Optional local dev files (`data-sources/esv.spb`, `.cache/esv-local/`) are gitignored and restricted to local development.
  - Non-commercial ESV API terms apply per your Crossway API key agreement.

---

## 4. Commentaries — HelloAO API

- **Access:** Proxied live at runtime from [`bible.helloao.org`](https://bible.helloao.org/) via `/api/commentary/:commentaryId/:usfm/:chapter` (`src/worker/helloao.ts`, `src/shared/commentaries.ts`)
- **Sources & Licenses:**
  - **Tyndale Open Study Notes** (Tyndale House Publishers) — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
  - **Matthew Henry's Complete Commentary on the Whole Bible** — [Public Domain](https://creativecommons.org/publicdomain/mark/1.0/)

---

## 5. Bundled Korean Lexicon (`public/data/lexicon.json`)

- **Location:** `public/data/lexicon.json`, compiled by `scripts/build-bible-data.ts` alongside project-authored biblical disambiguations and KRV grammar notes in `src/shared/biblical-glossary.ts`.
- **Upstream Dictionary Sources:**
  1. **KRDICT (`세계인이 누리는 한국어 학습사전`):**
     - **Author / Publisher:** 국립국어원 (National Institute of Korean Language), packaged in Yomitan format via [`Lyroxide/yomitan-ko-dic`](https://github.com/Lyroxide/yomitan-ko-dic) (`KO-EN.KRDICT.No.Examples.zip`, revision `krdict_ko-en_0924`, build date `20240812`)
     - **Source URL:** <https://krdict.korean.go.kr/eng/mainAction>
     - **License:** [CC BY-SA 2.0 KR](https://krdict.korean.go.kr/kor/kboardPolicy/copyRightTermsInfo)
  2. **Wiktionary (Korean) via Kaikki.org / Wiktextract:**
     - **Author / Extractor:** Wiktionary contributors; structured JSONL extraction by Tatu Ylonen ([`kaikki.org`](https://kaikki.org/dictionary/Korean/))
     - **License:** Dual-licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and GNU Free Documentation License (GFDL)
  3. **Kengdic (`garfieldnate/kengdic`):**
     - **Author:** Joe Speigle ([`garfieldnate/kengdic`](https://github.com/garfieldnate/kengdic), pinned commit `793de2369c9a98b944154eb4695d26854d2de59b` in `scripts/build-bible-data.ts`)
     - **License:** Dual-licensed under [MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/) or LGPL 2.0 or later
- **Build-Time Modifications:** `scripts/build-bible-data.ts` filters inflected/noisy headwords, cleans HTML entities and formatting, ranks candidate senses for biblical context, and compacts the output to lemmas matched across the 66-book KRV corpus.
