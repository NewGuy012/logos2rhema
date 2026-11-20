# /// script
# requires-python = ">=3.11,<3.15"
# dependencies = [
#   "lameenc>=1.7",
#   "numpy>=1.26",
#   "supertonic>=1.3",
# ]
# ///
"""Offline Supertonic 3 (Daniel / M5) KRV chapter audio and verse timing generator."""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import gc
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import lameenc
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
KRV_BIBLE_DIR = ROOT_DIR / "public" / "data" / "bibles" / "krv"
BOOKS_TS_PATH = ROOT_DIR / "src" / "shared" / "books.ts"
TIMINGS_OUT_DIR = ROOT_DIR / "public" / "data" / "timings" / "krv-supertonic"
CACHE_DIR = ROOT_DIR / ".cache"
AUDIO_CACHE_DIR = CACHE_DIR / "krv-supertonic-audio"
REPORT_PATH = CACHE_DIR / "krv-supertonic-report.json"

AUDIO_SOURCE_ID = "custom:krv:supertonic"
VOICE_ALIASES = {
    "daniel": "M5",
}

BOOK_ROW_RE = re.compile(
    r'\["([A-Z0-9]+)",\s*"[^"]+",\s*"([^"]+)",\s*"[^"]+",\s*"[^"]+",\s*(\d+)\]'
)
OMITTED_VERSE_RE = re.compile(r"^\(\s*없\s*음\s*\)$")
SELAH_RE = re.compile(r"\(\s*(?:힉가욘\s*,\s*)?셀\s*라\s*\)")
TRAILING_DASH_ELLIPSIS_RE = re.compile(r"[―…]+\s*$")
INLINE_DASH_ELLIPSIS_RE = re.compile(r"\s*[―…]+\s*")
PAREN_PAIR_RE = re.compile(r"\(\s*([^()]+?)\s*\)")
CLAUSE_END_RE = re.compile(
    r"(?:리라|노라|더라|니라|느뇨|시며|하며|하니|하고|더니|므로|이니|로다|소서|으라|어라|지라)\s+"
)

MAX_KO_CHUNK_CHARS = 120
MIN_VERSE_DURATION_SEC = 0.25
TARGET_RMS_DBFS = -19.0
PEAK_CEILING_DBFS = -1.0
MAX_GAIN = 6.0

_WORKER_TTS: Any = None
_WORKER_STYLE: Any = None


@dataclass(frozen=True)
class VerseJob:
    verse: int
    spoken_text: str
    chunks: list[str]


@dataclass(frozen=True)
class SynthConfig:
    steps: int
    speed: float
    verse_pause_sec: float
    header_pause_sec: float
    bitrate_kbps: int
    audio_dir: Path = AUDIO_CACHE_DIR


def load_book_catalog() -> dict[str, tuple[int, str]]:
    text = BOOKS_TS_PATH.read_text(encoding="utf-8")
    matches = BOOK_ROW_RE.findall(text)
    if len(matches) != 66:
        raise RuntimeError(
            f"Expected 66 books from {BOOKS_TS_PATH}, parsed {len(matches)}"
        )
    return {usfm: (idx + 1, ko) for idx, (usfm, ko, _) in enumerate(matches)}


def load_korean_book_names() -> dict[str, str]:
    return {usfm: ko for usfm, (_, ko) in load_book_catalog().items()}


def load_krv_books(wanted_usfms: list[str] | None = None) -> list[dict[str, Any]]:
    books: list[dict[str, Any]] = []
    if wanted_usfms is not None:
        for usfm in wanted_usfms:
            path = KRV_BIBLE_DIR / f"{usfm}.json"
            if not path.exists():
                raise RuntimeError(f"Missing KRV book JSON for {usfm}: {path}")
            with path.open("r", encoding="utf-8") as fh:
                books.append(json.load(fh))
        return books

    for path in KRV_BIBLE_DIR.glob("*.json"):
        with path.open("r", encoding="utf-8") as fh:
            books.append(json.load(fh))
    books.sort(key=lambda b: int(b["bookNumber"]))
    if len(books) != 66:
        raise RuntimeError(f"Expected 66 KRV book JSON files, found {len(books)}")
    return books


def format_chapter_header(usfm: str, book_ko: str, chapter: int) -> str:
    if usfm == "PSA":
        return f"시편 {chapter}편."
    return f"{book_ko} {chapter}장."


def normalize_krv_text(raw_text: str) -> str | None:
    text = raw_text.strip()
    if not text or OMITTED_VERSE_RE.match(text):
        return None

    # Strip musical notation `(셀라)` without touching proper nouns (`므두셀라`, `셀라`).
    text = SELAH_RE.sub(" ", text)
    text = text.replace("[", " ").replace("]", " ").replace("「", "'").replace("」", "'")
    text = TRAILING_DASH_ELLIPSIS_RE.sub(".", text)
    text = INLINE_DASH_ELLIPSIS_RE.sub(", ", text)

    # Convert inline parentheticals into spoken pauses while preserving attached particles.
    def _replace_paren(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        if not inner:
            return " "
        start, end = match.span()
        before = text[start - 1] if start > 0 else ""
        after = text[end] if end < len(text) else ""
        prefix = "" if (start == 0 or before.isspace() or before in ",;:.!?") else ", "
        if end == len(text) or after in ".,!?;:":
            suffix = ""
        elif after.isspace():
            suffix = ", "
        else:
            # Separate attached Hangul particles cleanly without injecting a comma.
            suffix = " "
        return f"{prefix}{inner}{suffix}"

    # Loop for nested parens, then clear unmatched multi-verse parens.
    prev = None
    while prev != text:
        prev = text
        text = PAREN_PAIR_RE.sub(_replace_paren, text)

    text = re.sub(r"\s*\(\s*", lambda m: "" if m.start() == 0 else ", ", text)
    text = re.sub(
        r"\s*\)\s*",
        lambda m: "" if m.end() == len(text) or text[m.end() : m.end() + 1] in ".,!?;:" else ", ",
        text,
    )

    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*,\s*", ", ", text)
    text = re.sub(r"(?:,\s*){2,}", ", ", text)
    text = re.sub(r"^[,.\s]+", "", text)
    text = re.sub(r",\s*([.!?])$", r"\1", text)
    text = re.sub(r"\s+([.!?])$", r"\1", text)
    text = text.strip()
    if not text:
        return None
    if text[-1] not in ".!?,":
        text += "."
    return text


def split_korean_chunks(text: str, max_len: int = MAX_KO_CHUNK_CHARS) -> list[str]:
    if len(text) <= max_len:
        return [text]

    chunks: list[str] = []
    remaining = text.strip()
    soft_limit = max(40, max_len - 1)
    while len(remaining) > max_len:
        window = remaining[: soft_limit + 1]
        split_at = -1

        # Prefer punctuation, then Korean clause endings, then whitespace.
        for m in re.finditer(r"[,.;!?]\s+", window):
            if m.end() >= 28:
                split_at = m.end()

        if split_at == -1:
            for m in CLAUSE_END_RE.finditer(window):
                if m.end() >= 28:
                    split_at = m.end()

        if split_at == -1:
            ws = window.rfind(" ")
            split_at = ws + 1 if ws >= 20 else soft_limit

        head = remaining[:split_at].strip()
        remaining = remaining[split_at:].strip()
        if head:
            if head[-1] not in ",.;!?":
                head += ","
            chunks.append(head)

    if remaining:
        chunks.append(remaining)
    return chunks


def prepare_chapter_verses(raw_verses: list[dict[str, Any]]) -> list[VerseJob]:
    jobs: list[VerseJob] = []
    for entry in raw_verses:
        verse_num = int(entry["verse"])
        raw_text = str(entry.get("text", ""))
        spoken = normalize_krv_text(raw_text)
        if not spoken:
            continue
        chunks = split_korean_chunks(spoken)
        jobs.append(
            VerseJob(
                verse=verse_num,
                spoken_text=spoken,
                chunks=chunks,
            )
        )
    return jobs


def resolve_voice_name(requested: str, available: list[str]) -> str:
    by_lower = {name.lower(): name for name in available}
    key = requested.strip().lower()
    if key in by_lower:
        return by_lower[key]
    alias = VOICE_ALIASES.get(key)
    if alias and alias.lower() in by_lower:
        return by_lower[alias.lower()]
    raise ValueError(
        f"Voice '{requested}' not found. Available styles: {', '.join(available)} "
        f"(aliases: {', '.join(f'{k}->{v}' for k, v in VOICE_ALIASES.items())})"
    )


def trim_silence(
    wav: np.ndarray,
    sample_rate: int,
    *,
    attack_ms: float = 30.0,
    release_ms: float = 50.0,
    fade_ms: float = 5.0,
) -> np.ndarray:
    x = np.asarray(wav, dtype=np.float32).reshape(-1)
    if x.size == 0:
        return x

    peak = float(np.max(np.abs(x)))
    if peak < 1e-6:
        return x

    # Use smoothed short-window energy so brief zero-crossings inside consonants aren't clipped.
    win = max(1, int(0.010 * sample_rate))
    abs_x = np.abs(x)
    if abs_x.size >= win:
        kernel = np.ones(win, dtype=np.float32) / float(win)
        env = np.convolve(abs_x, kernel, mode="same")
    else:
        env = abs_x

    thresh = max(0.0015, peak * 0.012)
    active = np.where(env >= thresh)[0]
    if active.size == 0:
        return x

    attack_pad = int((attack_ms / 1000.0) * sample_rate)
    release_pad = int((release_ms / 1000.0) * sample_rate)
    start = max(0, int(active[0]) - attack_pad)
    end = min(x.size, int(active[-1]) + 1 + release_pad)

    trimmed = np.array(x[start:end], dtype=np.float32, copy=True)
    fade_samples = min(int((fade_ms / 1000.0) * sample_rate), trimmed.size // 4)
    if fade_samples > 1:
        ramp = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
        trimmed[:fade_samples] *= ramp
        trimmed[-fade_samples:] *= ramp[::-1]
    return trimmed


def synthesize_text_utterance(
    tts: Any,
    voice_style: Any,
    chunks: list[str],
    *,
    steps: int,
    speed: float,
    chunk_pause_sec: float = 0.12,
) -> np.ndarray:
    sample_rate = int(tts.sample_rate)
    chunk_pause = np.zeros(int(round(chunk_pause_sec * sample_rate)), dtype=np.float32)
    parts: list[np.ndarray] = []
    for chunk in chunks:
        wav, _dur = tts.synthesize(
            text=chunk,
            voice_style=voice_style,
            total_steps=steps,
            speed=speed,
            max_chunk_length=max(200, len(chunk) + 20),
            silence_duration=0.0,
            lang="ko",
        )
        trimmed = trim_silence(wav, sample_rate)
        if trimmed.size > 0:
            if parts and chunk_pause.size > 0:
                parts.append(chunk_pause)
            parts.append(trimmed)
    if not parts:
        return np.zeros(int(0.3 * sample_rate), dtype=np.float32)
    return parts[0] if len(parts) == 1 else np.concatenate(parts)


def master_chapter_audio(
    segments: list[np.ndarray],
) -> tuple[np.ndarray, float, float]:
    """Concatenate chapter PCM and apply consistent RMS + peak-safe mastering."""
    combined = np.concatenate(segments).astype(np.float32, copy=False)
    active = combined[np.abs(combined) > 0.003]
    if active.size == 0:
        return combined, -99.0, -99.0

    rms = float(np.sqrt(np.mean(active * active)))
    peak = float(np.max(np.abs(combined)))
    target_rms = 10.0 ** (TARGET_RMS_DBFS / 20.0)
    ceiling = 10.0 ** (PEAK_CEILING_DBFS / 20.0)

    gain = min(MAX_GAIN, target_rms / max(rms, 1e-6))
    if peak * gain > ceiling:
        gain = ceiling / max(peak, 1e-6)

    mastered = np.clip(combined * gain, -ceiling, ceiling)
    final_rms_db = 20.0 * float(np.log10(max(rms * gain, 1e-9)))
    final_peak_db = 20.0 * float(np.log10(max(float(np.max(np.abs(mastered))), 1e-9)))
    return mastered, round(final_rms_db, 2), round(final_peak_db, 2)


def encode_cbr_mp3(
    pcm_float: np.ndarray,
    sample_rate: int,
    bitrate_kbps: int,
    out_path: Path,
) -> int:
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate_kbps)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    encoder.set_vbr(0)
    encoder.silence()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(f".{os.getpid()}.mp3.tmp")
    total_bytes = 0
    chunk_samples = 524_288

    try:
        with tmp_path.open("wb") as fh:
            for offset in range(0, pcm_float.size, chunk_samples):
                slice_f = pcm_float[offset : offset + chunk_samples]
                pcm_i16 = np.clip(np.rint(slice_f * 32767.0), -32768, 32767).astype("<i2")
                encoded = encoder.encode(pcm_i16.tobytes())
                if encoded:
                    fh.write(encoded)
                    total_bytes += len(encoded)
            flushed = encoder.flush()
            if flushed:
                fh.write(flushed)
                total_bytes += len(flushed)
        os.replace(tmp_path, out_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    return total_bytes


def synthesize_chapter(
    tts: Any,
    voice_style: Any,
    *,
    usfm: str,
    book_ko: str,
    chapter: int,
    verses: list[VerseJob],
    cfg: SynthConfig,
    mp3_path: Path,
) -> tuple[dict[str, float], dict[str, Any]]:
    sr = int(tts.sample_rate)
    header_text = format_chapter_header(usfm, book_ko, chapter)
    header_pcm = synthesize_text_utterance(
        tts,
        voice_style,
        [header_text],
        steps=cfg.steps,
        speed=cfg.speed,
    )
    header_pause = np.zeros(int(round(cfg.header_pause_sec * sr)), dtype=np.float32)
    verse_pause = np.zeros(int(round(cfg.verse_pause_sec * sr)), dtype=np.float32)

    segments: list[np.ndarray] = [header_pcm, header_pause]
    sample_cursor = int(header_pcm.size + header_pause.size)
    timings: dict[str, float] = {}
    prev_start = -1.0

    for idx, v in enumerate(verses):
        verse_pcm = synthesize_text_utterance(
            tts,
            voice_style,
            v.chunks,
            steps=cfg.steps,
            speed=cfg.speed,
        )
        verse_dur = float(verse_pcm.size) / float(sr)
        if verse_dur < MIN_VERSE_DURATION_SEC:
            raise RuntimeError(
                f"{usfm} {chapter}:{v.verse} synthesized too short ({verse_dur:.3f}s < {MIN_VERSE_DURATION_SEC}s)"
            )

        start_sec = round(sample_cursor / float(sr), 3)
        if start_sec <= prev_start:
            raise RuntimeError(
                f"{usfm} {chapter}:{v.verse} non-monotonic timestamp {start_sec} <= {prev_start}"
            )
        prev_start = start_sec
        timings[str(v.verse)] = start_sec

        segments.append(verse_pcm)
        sample_cursor += int(verse_pcm.size)
        if idx + 1 < len(verses) and verse_pause.size > 0:
            segments.append(verse_pause)
            sample_cursor += int(verse_pause.size)

    mastered, rms_dbfs, peak_dbfs = master_chapter_audio(segments)
    total_duration = float(mastered.size) / float(sr)
    if not timings or prev_start >= total_duration:
        raise RuntimeError(
            f"{usfm} {chapter}: invalid final timestamp {prev_start} >= duration {total_duration:.3f}s"
        )

    mp3_bytes = encode_cbr_mp3(mastered, sr, cfg.bitrate_kbps, mp3_path)

    metrics = {
        "duration": round(total_duration, 2),
        "versesSynthesized": len(verses),
        "headerText": header_text,
        "v1Start": timings[str(verses[0].verse)],
        "rmsDbfs": rms_dbfs,
        "peakDbfs": peak_dbfs,
        "mp3Bytes": mp3_bytes,
    }
    return timings, metrics


def atomic_write_json(path: Path, data: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as fh:
            if compact:
                json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
            else:
                json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def empty_book_timings(usfm: str) -> dict[str, Any]:
    return {
        "translationId": "krv",
        "audioSource": AUDIO_SOURCE_ID,
        "usfm": usfm,
        "chapters": {},
    }


def load_existing_book_timings(path: Path, usfm: str) -> dict[str, Any]:
    if path.exists():
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and isinstance(data.get("chapters"), dict):
            return data
    return empty_book_timings(usfm)


def parse_book_codes(raw_values: list[str] | None) -> list[str]:
    if not raw_values:
        return []
    seen: set[str] = set()
    codes: list[str] = []
    for raw in raw_values:
        for part in str(raw).split(","):
            code = part.strip().upper()
            if code and code not in seen:
                seen.add(code)
                codes.append(code)
    return codes


def load_job_manifest(
    path: Path, catalog: dict[str, tuple[int, str]]
) -> tuple[list[str], dict[str, set[int]]]:
    with path.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)
    books_raw = raw.get("books") if isinstance(raw, dict) else None
    if not isinstance(books_raw, dict) or not books_raw:
        raise SystemExit(f"Invalid job manifest (expected non-empty 'books' map): {path}")

    wanted_usfms: list[str] = []
    chapter_map: dict[str, set[int]] = {}
    for raw_usfm, raw_chapters in books_raw.items():
        usfm = str(raw_usfm).strip().upper()
        if usfm not in catalog:
            raise SystemExit(f"Unknown USFM book code in manifest {path}: {raw_usfm}")
        if not isinstance(raw_chapters, list):
            raise SystemExit(f"Invalid chapter list for {usfm} in manifest {path}")
        chapters = {int(ch) for ch in raw_chapters}
        if not chapters:
            continue
        wanted_usfms.append(usfm)
        chapter_map[usfm] = chapters
    return wanted_usfms, chapter_map


def resolve_requested_usfms(
    args: argparse.Namespace, catalog: dict[str, tuple[int, str]]
) -> list[str] | None:
    if args.testament == "OT":
        return [usfm for usfm, (num, _) in catalog.items() if num <= 39]
    if args.testament == "NT":
        return [usfm for usfm, (num, _) in catalog.items() if num >= 40]
    wanted = parse_book_codes(args.books)
    if wanted:
        missing = [code for code in wanted if code not in catalog]
        if missing:
            raise SystemExit(f"Unknown USFM book code(s): {', '.join(missing)}")
        return wanted
    return None


def configure_onnx_providers(requested_device: str) -> tuple[str, list[str]]:
    import onnxruntime as ort
    import supertonic.config as st_config
    import supertonic.loader as st_loader

    available = list(ort.get_available_providers())
    has_cuda = "CUDAExecutionProvider" in available

    if requested_device == "cuda":
        if not has_cuda:
            raise RuntimeError(
                "CUDA requested (--device cuda), but CUDAExecutionProvider is not available. "
                f"Installed ONNX providers: {available}"
            )
        desired = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        active_device = "cuda"
    elif requested_device == "auto" and has_cuda:
        desired = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        active_device = "cuda"
    else:
        desired = ["CPUExecutionProvider"]
        active_device = "cpu"

    st_config.DEFAULT_ONNX_PROVIDERS[:] = desired
    st_loader.DEFAULT_ONNX_PROVIDERS = list(desired)
    return active_device, available


def get_active_tts_providers(tts: Any) -> list[str]:
    model = getattr(tts, "model", None)
    for attr in ("vocoder_ort", "vector_est_ort", "text_enc_ort", "dp_ort"):
        session = getattr(model, attr, None)
        if session is not None and hasattr(session, "get_providers"):
            return list(session.get_providers())
    return []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Supertonic 3 KRV chapter MP3s and sample-accurate verse timing JSONs."
    )
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument(
        "--books",
        "--book",
        action="append",
        dest="books",
        help="USFM book code(s), repeatable or comma-separated (e.g. RUT or GEN,PSA,MAT). Defaults to all 66 books.",
    )
    scope.add_argument(
        "--testament",
        choices=["OT", "NT"],
        help="Generate all books in OT (1-39) or NT (40-66)",
    )
    scope.add_argument(
        "--all",
        action="store_true",
        help="Generate all 66 books (default when no scope flag is passed)",
    )
    scope.add_argument(
        "--job-manifest",
        type=Path,
        help="Optional JSON manifest mapping {'books': {'RUT': [1, 2, 3, 4]}} for incremental remote runs",
    )
    parser.add_argument(
        "--chapters",
        "--chapter",
        dest="chapters",
        help="Optional comma-separated chapter numbers (e.g. 23 or 1,3,23)",
    )
    parser.add_argument(
        "--voice",
        default="Daniel",
        help="Voice style name or alias (default: Daniel -> M5)",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=0.95,
        help="Speech speed multiplier (default: 0.95)",
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=10,
        help="Flow-matching inference steps (default: 10)",
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=0.30,
        help="Inter-verse silence pause in seconds (default: 0.30)",
    )
    parser.add_argument(
        "--header-pause",
        type=float,
        default=0.60,
        help="Pause after spoken chapter header before v.1 in seconds (default: 0.60)",
    )
    parser.add_argument(
        "--bitrate",
        type=int,
        default=96,
        help="CBR MP3 bitrate in kbps (default: 96)",
    )
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="ONNX execution device preference (default: auto)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=0,
        help="Parallel worker processes (default: 0 = auto based on device and job count)",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=2,
        help="ONNX intra-op threads per worker process (default: 2)",
    )
    parser.add_argument(
        "--audio-dir",
        type=Path,
        default=AUDIO_CACHE_DIR,
        help=f"Output directory for chapter MP3s (default: {AUDIO_CACHE_DIR})",
    )
    parser.add_argument(
        "--timings-dir",
        type=Path,
        default=TIMINGS_OUT_DIR,
        help=f"Output directory for per-book timing JSONs (default: {TIMINGS_OUT_DIR})",
    )
    parser.add_argument(
        "--report-path",
        type=Path,
        default=REPORT_PATH,
        help=f"Output path for generation report JSON (default: {REPORT_PATH})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-generate chapters even if MP3 and timing entry already exist",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate text normalization, chunking, and chapter headers without running ONNX",
    )
    return parser.parse_args()


def _init_worker(resolved_voice: str, intra_threads: int, active_device: str) -> None:
    global _WORKER_TTS, _WORKER_STYLE
    configure_onnx_providers(active_device)
    from supertonic import TTS

    _WORKER_TTS = TTS(
        model="supertonic-3",
        auto_download=False,
        intra_op_num_threads=intra_threads,
        inter_op_num_threads=1,
    )
    _WORKER_STYLE = _WORKER_TTS.get_voice_style(resolved_voice)


def _synthesize_job(
    tts: Any,
    voice_style: Any,
    job: tuple[str, str, int, list[VerseJob], int],
    cfg: SynthConfig,
) -> tuple[str, int, int, dict[str, float], dict[str, Any], float]:
    usfm, book_ko, ch_num, verses, total_verses = job
    mp3_path = cfg.audio_dir / usfm / f"{ch_num}.mp3"
    t0 = time.time()
    try:
        timings, metrics = synthesize_chapter(
            tts,
            voice_style,
            usfm=usfm,
            book_ko=book_ko,
            chapter=ch_num,
            verses=verses,
            cfg=cfg,
            mp3_path=mp3_path,
        )
        return usfm, ch_num, total_verses, timings, metrics, time.time() - t0
    finally:
        gc.collect()


def _process_chapter_job(
    job: tuple[str, str, int, list[VerseJob], int],
    cfg: SynthConfig,
) -> tuple[str, int, int, dict[str, float], dict[str, Any], float]:
    return _synthesize_job(_WORKER_TTS, _WORKER_STYLE, job, cfg)


def main() -> int:
    args = parse_args()
    audio_dir: Path = args.audio_dir
    timings_dir: Path = args.timings_dir
    report_path: Path = args.report_path

    catalog = load_book_catalog()
    book_names_ko = {usfm: ko for usfm, (_, ko) in catalog.items()}

    manifest_chapters: dict[str, set[int]] | None = None
    if args.job_manifest is not None:
        wanted_usfms, manifest_chapters = load_job_manifest(args.job_manifest, catalog)
        selected_books = load_krv_books(wanted_usfms) if wanted_usfms else []
    else:
        wanted_usfms = resolve_requested_usfms(args, catalog)
        selected_books = load_krv_books(wanted_usfms)

    chapter_filter = (
        {int(c.strip()) for c in str(args.chapters).split(",") if c.strip()}
        if args.chapters
        else None
    )

    jobs: list[tuple[str, str, int, list[VerseJob], int]] = []
    total_verses_checked = 0
    total_chunks = 0
    max_chunk_len = 0

    for book in selected_books:
        usfm = str(book["usfm"])
        book_ko = book_names_ko[usfm]
        out_path = timings_dir / f"{usfm}.json"
        existing = load_existing_book_timings(out_path, usfm) if not args.force else None
        existing_chapters = existing["chapters"] if existing else {}
        allowed_manifest_chapters = (
            manifest_chapters.get(usfm) if manifest_chapters is not None else None
        )

        for ch_key in sorted(book["chapters"].keys(), key=int):
            ch_num = int(ch_key)
            if allowed_manifest_chapters is not None and ch_num not in allowed_manifest_chapters:
                continue
            if chapter_filter is not None and ch_num not in chapter_filter:
                continue
            raw_verses = book["chapters"][ch_key]
            verses = prepare_chapter_verses(raw_verses)
            if not verses:
                continue

            total_verses_checked += len(verses)
            for v in verses:
                total_chunks += len(v.chunks)
                for c in v.chunks:
                    max_chunk_len = max(max_chunk_len, len(c))
                if "(" in v.spoken_text or ")" in v.spoken_text:
                    raise RuntimeError(
                        f"Unstripped parenthesis in {usfm} {ch_num}:{v.verse}: {v.spoken_text}"
                    )

            mp3_path = audio_dir / usfm / f"{ch_num}.mp3"
            has_mp3 = mp3_path.exists() and mp3_path.stat().st_size > 1024
            has_timings = ch_key in existing_chapters
            if not args.dry_run and not args.force and has_mp3 and has_timings:
                continue
            jobs.append((usfm, book_ko, ch_num, verses, len(raw_verses)))

    if args.dry_run:
        sample_headers = [
            format_chapter_header(
                str(b["usfm"]),
                book_names_ko[str(b["usfm"])],
                next(iter(sorted(b["chapters"].keys(), key=int))),
            )
            for b in selected_books[:3]
        ]
        if any(b["usfm"] == "PSA" for b in selected_books):
            sample_headers.append(format_chapter_header("PSA", book_names_ko["PSA"], 23))
        print(
            f"Dry-run validated {len(selected_books)} book(s), {len(jobs)} chapter(s), "
            f"{total_verses_checked} verse(s) ({total_chunks} chunks, max_chunk={max_chunk_len} chars). "
            f"Sample headers: {sample_headers}",
            flush=True,
        )
        return 0

    if not jobs:
        print("All selected chapters are already generated. Use --force to regenerate.", flush=True)
        return 0

    active_device, available_providers = configure_onnx_providers(args.device)
    from supertonic import TTS

    tts = TTS(
        model="supertonic-3",
        auto_download=True,
        intra_op_num_threads=args.threads,
        inter_op_num_threads=1,
    )
    active_providers = get_active_tts_providers(tts)
    if active_device == "cuda" and "CUDAExecutionProvider" not in active_providers:
        msg = (
            "CUDAExecutionProvider failed to initialize on ONNX session "
            f"(available={available_providers}, active={active_providers})."
        )
        if args.device == "cuda":
            raise RuntimeError(msg)
        print(f"Warning: {msg} Falling back to CPU.", file=sys.stderr, flush=True)
        active_device = "cpu"

    resolved_voice = resolve_voice_name(args.voice, tts.voice_style_names)

    # Validate entire selected corpus against Supertonic's character table up front.
    for usfm, book_ko, ch_num, verses, _ in jobs:
        header = format_chapter_header(usfm, book_ko, ch_num)
        ok, bad = tts.model.text_processor.validate_text(header)
        if not ok:
            raise RuntimeError(f"Unsupported chars in header {usfm} {ch_num}: {bad}")
        for v in verses:
            ok, bad = tts.model.text_processor.validate_text(v.spoken_text)
            if not ok:
                raise RuntimeError(
                    f"Unsupported chars in {usfm} {ch_num}:{v.verse}: {bad}"
                )

    if args.workers > 0:
        worker_count = args.workers
    elif active_device == "cuda":
        worker_count = min(2, len(jobs))
    else:
        cpu_count = os.cpu_count() or 6
        worker_count = 1 if len(jobs) <= 2 else min(6, max(1, cpu_count // max(1, args.threads)))
    worker_count = max(1, min(worker_count, len(jobs)))

    print(
        f"Generating {len(jobs)} chapter(s) across {len(selected_books)} book(s) "
        f"using Supertonic 3 voice '{args.voice}' ({resolved_voice}), "
        f"device={active_device} ({','.join(active_providers) or 'unknown'}), "
        f"workers={worker_count}, threads={args.threads}, "
        f"speed={args.speed}, steps={args.steps}, bitrate={args.bitrate}kbps...",
        flush=True,
    )

    report: dict[str, Any] = {}
    if report_path.exists():
        try:
            with report_path.open("r", encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                report = loaded
        except Exception:  # noqa: BLE001
            report = {}
    chapters_report: dict[str, Any] = report.setdefault("chapters", {})

    book_cache: dict[str, dict[str, Any]] = {}
    dirty_books: set[str] = set()
    remaining_by_book: dict[str, int] = {}
    for usfm, *_ in jobs:
        remaining_by_book[usfm] = remaining_by_book.get(usfm, 0) + 1

    completed = 0
    errors = 0
    started_at = time.time()

    def get_book_payload(usfm: str) -> dict[str, Any]:
        if usfm not in book_cache:
            out_path = timings_dir / f"{usfm}.json"
            if (
                args.force
                and usfm not in dirty_books
                and chapter_filter is None
                and manifest_chapters is None
            ):
                book_cache[usfm] = empty_book_timings(usfm)
            else:
                book_cache[usfm] = load_existing_book_timings(out_path, usfm)
        return book_cache[usfm]

    def flush_book(usfm: str) -> None:
        if usfm not in dirty_books:
            return
        payload = book_cache[usfm]
        payload["audioSource"] = AUDIO_SOURCE_ID
        payload["chapters"] = {
            k: payload["chapters"][k] for k in sorted(payload["chapters"].keys(), key=int)
        }
        atomic_write_json(timings_dir / f"{usfm}.json", payload, compact=True)
        dirty_books.discard(usfm)

    def record_success(
        idx_done: int,
        usfm: str,
        ch_num: int,
        total_verses: int,
        timings: dict[str, float],
        metrics: dict[str, Any],
        elapsed: float,
    ) -> None:
        nonlocal completed
        ref = f"{usfm}:{ch_num}"
        book_payload = get_book_payload(usfm)
        book_payload["chapters"][str(ch_num)] = timings
        dirty_books.add(usfm)

        chapters_report[ref] = {
            "status": "ok",
            "totalVerses": total_verses,
            "wallSeconds": round(elapsed, 2),
            **metrics,
        }
        completed += 1
        remaining_by_book[usfm] = max(0, remaining_by_book.get(usfm, 1) - 1)
        print(
            f"[{idx_done}/{len(jobs)}] {ref} "
            f"({metrics['versesSynthesized']}/{total_verses} vv, "
            f"{metrics['duration']}s audio in {elapsed:.1f}s, "
            f"v1={metrics['v1Start']}s, {metrics['mp3Bytes'] // 1024} KB)",
            flush=True,
        )

        if remaining_by_book[usfm] == 0:
            flush_book(usfm)
        elif completed % 10 == 0:
            for dirty_usfm in list(dirty_books):
                flush_book(dirty_usfm)
        if remaining_by_book[usfm] == 0 or completed % 10 == 0:
            atomic_write_json(report_path, report, compact=False)

    def record_error(idx_done: int, usfm: str, ch_num: int, err: Exception) -> None:
        nonlocal errors
        errors += 1
        remaining_by_book[usfm] = max(0, remaining_by_book.get(usfm, 1) - 1)
        chapters_report[f"{usfm}:{ch_num}"] = {"status": "error", "error": str(err)}
        print(
            f"[{idx_done}/{len(jobs)}] {usfm}:{ch_num} — ERROR: {err}",
            file=sys.stderr,
            flush=True,
        )

    def run_job_step(
        idx_done: int,
        usfm: str,
        ch_num: int,
        fn: Callable[[], tuple[str, int, int, dict[str, float], dict[str, Any], float]],
    ) -> None:
        try:
            res_usfm, res_ch, total_verses, timings, metrics, elapsed = fn()
            record_success(
                idx_done, res_usfm, res_ch, total_verses, timings, metrics, elapsed
            )
        except Exception as err:  # noqa: BLE001
            record_error(idx_done, usfm, ch_num, err)

    cfg = SynthConfig(
        steps=args.steps,
        speed=args.speed,
        verse_pause_sec=args.pause,
        header_pause_sec=args.header_pause,
        bitrate_kbps=args.bitrate,
        audio_dir=audio_dir,
    )

    try:
        if worker_count == 1:
            voice_style = tts.get_voice_style(resolved_voice)
            for idx, job in enumerate(jobs, start=1):
                run_job_step(
                    idx,
                    job[0],
                    job[2],
                    lambda j=job: _synthesize_job(tts, voice_style, j, cfg),
                )
        else:
            # Release main-process ONNX model memory before spawning worker processes.
            del tts
            gc.collect()
            with ProcessPoolExecutor(
                max_workers=worker_count,
                initializer=_init_worker,
                initargs=(resolved_voice, args.threads, active_device),
            ) as executor:
                future_to_ref = {
                    executor.submit(_process_chapter_job, job, cfg): (job[0], job[2])
                    for job in jobs
                }
                for done_idx, future in enumerate(as_completed(future_to_ref), start=1):
                    usfm, ch_num = future_to_ref[future]
                    run_job_step(done_idx, usfm, ch_num, future.result)
    finally:
        for dirty_usfm in list(dirty_books):
            flush_book(dirty_usfm)
        report["summary"] = {
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "voice": args.voice,
            "resolvedVoice": resolved_voice,
            "device": active_device,
            "onnxProviders": active_providers,
            "workers": worker_count,
            "threads": args.threads,
            "speed": args.speed,
            "steps": args.steps,
            "bitrateKbps": args.bitrate,
            "completedInRun": completed,
            "errorsInRun": errors,
            "totalSeconds": round(time.time() - started_at, 1),
        }
        atomic_write_json(report_path, report, compact=False)

    print(
        f"Done in {time.time() - started_at:.1f}s: "
        f"{completed} generated, {errors} error(s). "
        f"Report: {report_path}",
        flush=True,
    )
    return 1 if errors > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
