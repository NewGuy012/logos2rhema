# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#   "requests>=2.31",
#   "soundfile>=0.12",
#   "torch>=2.2",
#   "torchaudio>=2.2",
#   "unidecode>=1.3",
# ]
# ///
"""Offline forced-alignment batch tool for Wordproject Korean (KRV) audio chapters.

Fetches chapter audio URLs from HelloAO (`kor_old`), aligns each MP3 against the
bundled KRV chapter text (`public/data/bibles/krv/{USFM}.json`) using Meta MMS
(`torchaudio.pipelines.MMS_FA` on Apple Silicon MPS with CPU fallback), validates
monotonicity/confidence, and writes compact per-book timing JSONs to
`public/data/timings/krv-wordproject/{USFM}.json`.
"""

from __future__ import annotations

import argparse
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import re
import sys
import threading
import time
from typing import Any

import requests
import soundfile as sf
import torch
import torchaudio
from unidecode import unidecode

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

ROOT_DIR = Path(__file__).resolve().parent.parent
KRV_BIBLE_DIR = ROOT_DIR / "public" / "data" / "bibles" / "krv"
TIMINGS_OUT_DIR = ROOT_DIR / "public" / "data" / "timings" / "krv-wordproject"
CACHE_DIR = ROOT_DIR / ".cache"
AUDIO_CACHE_DIR = CACHE_DIR / "krv-wordproject-audio"
REPORT_PATH = CACHE_DIR / "krv-alignment-report.json"

HELLOAO_CHAPTER_URL = "https://bible.helloao.org/api/kor_old/{usfm}/{chapter}.json"
OMITTED_VERSE_RE = re.compile(r"^\(\s*없\s*음\s*\)$")
PAREN_REF_RE = re.compile(r"\([^)]*\d[^)]*\)")
LOW_PROB_THRESHOLD = 0.72
MIN_VERSE_DURATION_SEC = 0.3
FRAMES_PER_SEC = 50  # Wav2Vec2 20ms stride at 16kHz

_thread_local = threading.local()


@dataclass
class PreparedVerse:
    verse: int
    words: list[str]


def get_http_session() -> requests.Session:
    session = getattr(_thread_local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers.update({"User-Agent": "Logos2Rhema-AudioAligner/1.0"})
        _thread_local.session = session
    return session


def load_krv_books() -> list[dict[str, Any]]:
    books: list[dict[str, Any]] = []
    for path in KRV_BIBLE_DIR.glob("*.json"):
        with path.open("r", encoding="utf-8") as fh:
            books.append(json.load(fh))
    books.sort(key=lambda b: int(b["bookNumber"]))
    return books


def romanize_korean_words(text: str, vocab_dict: dict[str, int]) -> list[str]:
    cleaned = PAREN_REF_RE.sub(" ", text)
    romanized = unidecode(cleaned).lower()
    words: list[str] = []
    for raw_word in romanized.split():
        token = "".join(ch for ch in raw_word if ch in vocab_dict and ch not in ("-", "*"))
        if token:
            words.append(token)
    return words


def prepare_chapter_verses(
    raw_verses: list[dict[str, Any]],
    vocab_dict: dict[str, int],
) -> tuple[list[PreparedVerse], list[str]]:
    prepared: list[PreparedVerse] = []
    all_words: list[str] = []
    for entry in raw_verses:
        verse_num = int(entry["verse"])
        text = str(entry.get("text", "")).strip()
        if not text or OMITTED_VERSE_RE.match(text):
            continue
        words = romanize_korean_words(text, vocab_dict)
        if not words:
            continue
        prepared.append(PreparedVerse(verse=verse_num, words=words))
        all_words.extend(words)
    return prepared, all_words


def fetch_with_retry(
    session: requests.Session,
    url: str,
    *,
    stream: bool = False,
    timeout: int = 30,
    attempts: int = 3,
) -> requests.Response:
    last_err: Exception | None = None
    for attempt in range(attempts):
        try:
            resp = session.get(url, stream=stream, timeout=timeout)
            resp.raise_for_status()
            return resp
        except Exception as err:  # noqa: BLE001
            last_err = err
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    assert last_err is not None
    raise last_err


def ensure_chapter_audio(
    usfm: str,
    chapter: int,
    audio_dir: Path,
) -> Path | None:
    mp3_path = audio_dir / usfm / f"{chapter}.mp3"
    if mp3_path.exists() and mp3_path.stat().st_size > 1024:
        return mp3_path

    session = get_http_session()
    meta_url = HELLOAO_CHAPTER_URL.format(usfm=usfm, chapter=chapter)
    meta_resp = fetch_with_retry(session, meta_url, timeout=20)
    payload = meta_resp.json()
    mp3_url = (payload.get("thisChapterAudioLinks") or {}).get("wordproject")
    if not mp3_url or not str(mp3_url).startswith("https://"):
        return None

    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = mp3_path.with_suffix(".mp3.tmp")
    with fetch_with_retry(session, str(mp3_url), stream=True, timeout=60) as audio_resp:
        with tmp_path.open("wb") as fh:
            for chunk in audio_resp.iter_content(chunk_size=65536):
                if chunk:
                    fh.write(chunk)
    os.replace(tmp_path, mp3_path)
    return mp3_path


def load_waveform_mono_16k(mp3_path: Path, target_sr: int) -> torch.Tensor:
    data, sr = sf.read(str(mp3_path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    waveform = torch.from_numpy(data).unsqueeze(0)
    if sr != target_sr:
        waveform = torchaudio.functional.resample(waveform, sr, target_sr)
    return waveform


def generate_emissions_chunked(
    model: torch.nn.Module,
    waveform: torch.Tensor,
    device: torch.device,
    sample_rate: int,
    batch_size: int,
    window_sec: int = 30,
    context_sec: int = 2,
) -> torch.Tensor:
    total_samples = waveform.size(1)
    if total_samples <= 90 * sample_rate:
        with torch.inference_mode():
            emissions, _ = model(waveform.to(device))
            emissions = emissions.cpu()[0]
    else:
        ctx = context_sec * sample_rate
        win = window_sec * sample_rate
        ext = math.ceil(total_samples / win) * win - total_samples
        padded = torch.nn.functional.pad(waveform, (ctx, ctx + ext))
        num_windows = (padded.size(1) - 2 * ctx) // win
        chunks = torch.cat(
            [padded[:, i * win : i * win + win + 2 * ctx] for i in range(num_windows)],
            dim=0,
        )
        em_parts: list[torch.Tensor] = []
        with torch.inference_mode():
            for i in range(0, num_windows, batch_size):
                out, _ = model(chunks[i : i + batch_size].to(device))
                em_parts.append(out.cpu())
        em = torch.cat(em_parts, dim=0)
        ctx_frames = context_sec * FRAMES_PER_SEC
        em = em[:, ctx_frames : -ctx_frames + 1, :].reshape(-1, em.shape[-1])
        ext_frames = int(ext / sample_rate * FRAMES_PER_SEC)
        if ext_frames > 0:
            em = em[:-ext_frames, :]
        emissions = em

    return torch.cat(
        [emissions, torch.zeros((emissions.size(0), 1), dtype=emissions.dtype)],
        dim=-1,
    )


def align_chapter(
    model: torch.nn.Module,
    tokenizer: Any,
    aligner: Any,
    device: torch.device,
    sample_rate: int,
    mp3_path: Path,
    prepared_verses: list[PreparedVerse],
    all_words: list[str],
    batch_size: int,
) -> tuple[dict[str, float], dict[str, Any]]:
    waveform = load_waveform_mono_16k(mp3_path, sample_rate)
    audio_duration = float(waveform.size(1)) / float(sample_rate)
    emissions = generate_emissions_chunked(
        model,
        waveform,
        device,
        sample_rate,
        batch_size=batch_size,
    )
    frame_sec = float(waveform.size(1)) / float(emissions.size(0)) / float(sample_rate)

    tokens = tokenizer(["*"] + all_words + ["*"])
    spans = aligner(emissions, tokens)
    word_spans = spans[1:-1]

    if len(word_spans) != len(all_words):
        raise RuntimeError(
            f"Word alignment count mismatch: expected {len(all_words)}, got {len(word_spans)}"
        )

    chapter_timings: dict[str, float] = {}
    low_prob_verses: list[dict[str, Any]] = []
    short_verses: list[dict[str, Any]] = []
    rounded_adjustments: list[int] = []
    verse_probs: list[float] = []

    cursor = 0
    prev_start = -0.1
    for pv in prepared_verses:
        word_count = len(pv.words)
        chunk = word_spans[cursor : cursor + word_count]
        cursor += word_count

        raw_start = float(chunk[0][0].start) * frame_sec
        raw_end = float(chunk[-1][-1].end) * frame_sec
        span_dur = raw_end - raw_start
        tok_scores = [float(tok.score) for word_span in chunk for tok in word_span]
        avg_prob = sum(tok_scores) / max(1, len(tok_scores))
        verse_probs.append(avg_prob)

        if raw_start >= audio_duration or raw_start < 0:
            raise RuntimeError(
                f"Verse {pv.verse} timestamp {raw_start:.2f}s out of bounds (dur={audio_duration:.2f}s)"
            )

        start_sec = round(raw_start, 1)
        if start_sec <= prev_start:
            start_sec = round(prev_start + 0.1, 1)
            rounded_adjustments.append(pv.verse)
        prev_start = start_sec
        chapter_timings[str(pv.verse)] = start_sec

        if avg_prob < LOW_PROB_THRESHOLD:
            low_prob_verses.append({"verse": pv.verse, "avgProb": round(avg_prob, 3)})
        if span_dur < MIN_VERSE_DURATION_SEC:
            short_verses.append({"verse": pv.verse, "duration": round(span_dur, 2)})

    mean_prob = sum(verse_probs) / max(1, len(verse_probs))
    metrics: dict[str, Any] = {
        "duration": round(audio_duration, 1),
        "versesAligned": len(chapter_timings),
        "meanProb": round(mean_prob, 3),
        "lowProbVerses": low_prob_verses,
        "shortVerses": short_verses,
        "roundedAdjustments": rounded_adjustments,
    }
    return chapter_timings, metrics


def atomic_write_json(path: Path, data: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        if compact:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def load_existing_book_timings(path: Path, usfm: str) -> dict[str, Any]:
    if path.exists():
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and isinstance(data.get("chapters"), dict):
            return data
    return {
        "translationId": "krv",
        "audioSource": "helloao:krv:wordproject",
        "usfm": usfm,
        "chapters": {},
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Align Wordproject Korean (KRV) chapter MP3s into static verse timing JSONs."
    )
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument(
        "--books",
        help="Comma-separated USFM book codes (e.g. GEN,JHN,PSA)",
    )
    scope.add_argument(
        "--testament",
        choices=["OT", "NT"],
        help="Align all books in OT (1-39) or NT (40-66)",
    )
    scope.add_argument(
        "--all",
        action="store_true",
        help="Align all 66 books",
    )
    parser.add_argument(
        "--chapters",
        help="Optional comma-separated chapter numbers (e.g. 1,3,23)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-align chapters even if already present in output JSON",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate transcript preprocessing without downloading audio or running alignment",
    )
    parser.add_argument(
        "--cleanup-audio",
        action="store_true",
        help="Delete cached MP3 file after aligning each chapter",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=8,
        help="Chunk batch size for long chapters (default: 8)",
    )
    return parser.parse_args()


def select_books(all_books: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.all:
        return all_books
    if args.testament == "OT":
        return [b for b in all_books if int(b["bookNumber"]) <= 39]
    if args.testament == "NT":
        return [b for b in all_books if int(b["bookNumber"]) >= 40]

    wanted = [code.strip().upper() for code in str(args.books).split(",") if code.strip()]
    by_usfm = {b["usfm"]: b for b in all_books}
    missing = [code for code in wanted if code not in by_usfm]
    if missing:
        raise SystemExit(f"Unknown USFM book code(s): {', '.join(missing)}")
    return [by_usfm[code] for code in wanted]


def main() -> int:
    args = parse_args()
    bundle = torchaudio.pipelines.MMS_FA
    vocab_dict = bundle.get_dict()

    all_books = load_krv_books()
    selected_books = select_books(all_books, args)
    chapter_filter = (
        {int(c.strip()) for c in args.chapters.split(",") if c.strip()}
        if args.chapters
        else None
    )

    jobs: list[tuple[str, int, list[PreparedVerse], list[str], int]] = []
    for book in selected_books:
        usfm = str(book["usfm"])
        out_path = TIMINGS_OUT_DIR / f"{usfm}.json"
        existing = load_existing_book_timings(out_path, usfm) if not args.force else None
        existing_chapters = existing["chapters"] if existing else {}

        chapters_sorted = sorted(book["chapters"].keys(), key=int)
        for ch_key in chapters_sorted:
            ch_num = int(ch_key)
            if chapter_filter is not None and ch_num not in chapter_filter:
                continue
            if not args.dry_run and not args.force and ch_key in existing_chapters:
                continue
            raw_verses = book["chapters"][ch_key]
            prepared, all_words = prepare_chapter_verses(raw_verses, vocab_dict)
            if not prepared:
                continue
            if not args.dry_run:
                jobs.append((usfm, ch_num, prepared, all_words, len(raw_verses)))

    if args.dry_run:
        print(f"Dry-run validated {len(selected_books)} book(s) successfully.")
        return 0

    if not jobs:
        print("All selected chapters are already aligned. Use --force to re-align.")
        return 0

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Aligning {len(jobs)} chapter(s) across {len(selected_books)} book(s) on {device}...")
    model = bundle.get_model(with_star=False).to(device).eval()
    tokenizer = bundle.get_tokenizer()
    aligner = bundle.get_aligner()

    report: dict[str, Any] = {}
    if REPORT_PATH.exists():
        try:
            with REPORT_PATH.open("r", encoding="utf-8") as fh:
                loaded_report = json.load(fh)
            if isinstance(loaded_report, dict):
                report = loaded_report
        except Exception:  # noqa: BLE001
            report = {}
    chapters_report: dict[str, Any] = report.setdefault("chapters", {})

    book_cache: dict[str, dict[str, Any]] = {}
    dirty_books: set[str] = set()
    completed = 0
    flagged = 0
    errors = 0
    started_at = time.time()

    def get_book_payload(usfm: str) -> dict[str, Any]:
        if usfm not in book_cache:
            out_path = TIMINGS_OUT_DIR / f"{usfm}.json"
            if args.force and usfm not in dirty_books and chapter_filter is None:
                book_cache[usfm] = {
                    "translationId": "krv",
                    "audioSource": "helloao:krv:wordproject",
                    "usfm": usfm,
                    "chapters": {},
                }
            else:
                book_cache[usfm] = load_existing_book_timings(out_path, usfm)
        return book_cache[usfm]

    def flush_book(usfm: str) -> None:
        if usfm not in dirty_books:
            return
        payload = book_cache[usfm]
        sorted_chapters = {
            k: payload["chapters"][k] for k in sorted(payload["chapters"].keys(), key=int)
        }
        payload["chapters"] = sorted_chapters
        atomic_write_json(TIMINGS_OUT_DIR / f"{usfm}.json", payload, compact=True)
        dirty_books.discard(usfm)

    with ThreadPoolExecutor(max_workers=3) as download_pool:
        prefetch: dict[int, Future[Path | None]] = {}
        prefetch_window = 4
        for idx in range(min(prefetch_window, len(jobs))):
            u, ch, *_ = jobs[idx]
            prefetch[idx] = download_pool.submit(ensure_chapter_audio, u, ch, AUDIO_CACHE_DIR)

        try:
            for idx, (usfm, ch_num, prepared, all_words, total_verses) in enumerate(jobs):
                nxt = idx + prefetch_window
                if nxt < len(jobs):
                    nu, nch, *_ = jobs[nxt]
                    prefetch[nxt] = download_pool.submit(
                        ensure_chapter_audio, nu, nch, AUDIO_CACHE_DIR
                    )

                ref = f"{usfm}:{ch_num}"
                try:
                    mp3_path = prefetch.pop(idx).result()
                    if mp3_path is None:
                        chapters_report[ref] = {"status": "missing_audio"}
                        print(f"[{idx + 1}/{len(jobs)}] {ref} — skipped (no Wordproject MP3)")
                        continue

                    t0 = time.time()
                    timings, metrics = align_chapter(
                        model,
                        tokenizer,
                        aligner,
                        device,
                        bundle.sample_rate,
                        mp3_path,
                        prepared,
                        all_words,
                        args.batch_size,
                    )
                    if args.cleanup_audio and mp3_path.exists():
                        mp3_path.unlink()

                    book_payload = get_book_payload(usfm)
                    book_payload["chapters"][str(ch_num)] = timings
                    dirty_books.add(usfm)

                    has_warnings = bool(
                        metrics["lowProbVerses"]
                        or metrics["shortVerses"]
                        or metrics["roundedAdjustments"]
                    )
                    if has_warnings:
                        flagged += 1
                    chapters_report[ref] = {
                        "status": "flagged" if has_warnings else "ok",
                        "totalVerses": total_verses,
                        **metrics,
                    }
                    completed += 1
                    elapsed = time.time() - t0
                    warn_note = (
                        f" [flags: low={len(metrics['lowProbVerses'])}, "
                        f"short={len(metrics['shortVerses'])}, "
                        f"adj={len(metrics['roundedAdjustments'])}]"
                        if has_warnings
                        else ""
                    )
                    print(
                        f"[{idx + 1}/{len(jobs)}] {ref} "
                        f"({metrics['versesAligned']}/{total_verses} vv, "
                        f"{metrics['duration']}s in {elapsed:.1f}s, "
                        f"prob={metrics['meanProb']}){warn_note}"
                    )

                    is_book_end = idx + 1 == len(jobs) or jobs[idx + 1][0] != usfm
                    if is_book_end or completed % 10 == 0:
                        flush_book(usfm)
                        atomic_write_json(REPORT_PATH, report, compact=False)
                except Exception as err:  # noqa: BLE001
                    errors += 1
                    chapters_report[ref] = {"status": "error", "error": str(err)}
                    print(f"[{idx + 1}/{len(jobs)}] {ref} — ERROR: {err}", file=sys.stderr)
        finally:
            for dirty_usfm in list(dirty_books):
                flush_book(dirty_usfm)
            report["summary"] = {
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "completedInRun": completed,
                "flaggedInRun": flagged,
                "errorsInRun": errors,
                "totalSeconds": round(time.time() - started_at, 1),
            }
            atomic_write_json(REPORT_PATH, report, compact=False)

    print(
        f"Done in {time.time() - started_at:.1f}s: "
        f"{completed} aligned, {flagged} flagged, {errors} error(s). "
        f"Report: {REPORT_PATH}"
    )
    return 1 if errors > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
