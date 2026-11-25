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
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, as_completed, wait
import gc
import json
import multiprocessing
import os
import queue
import re
import sys
import threading
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
class ChapterJob:
    usfm: str
    book_ko: str
    chapter: int
    verses: list[VerseJob]
    total_verses: int

    @property
    def chunk_count(self) -> int:
        return 1 + sum(len(v.chunks) for v in self.verses)


@dataclass(frozen=True)
class SynthConfig:
    steps: int
    speed: float
    verse_pause_sec: float
    header_pause_sec: float
    bitrate_kbps: int
    audio_dir: Path = AUDIO_CACHE_DIR
    batch_size: int = 1
    mp3_quality: int = 2


def load_book_catalog() -> dict[str, tuple[int, str]]:
    text = BOOKS_TS_PATH.read_text(encoding="utf-8")
    matches = BOOK_ROW_RE.findall(text)
    if len(matches) != 66:
        raise RuntimeError(
            f"Expected 66 books from {BOOKS_TS_PATH}, parsed {len(matches)}"
        )
    return {usfm: (idx + 1, ko) for idx, (usfm, ko, _) in enumerate(matches)}


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

    # Exact O(N) sliding-window average matching np.convolve(..., mode="same").
    win = max(1, int(0.010 * sample_rate))
    abs_x = np.abs(x)
    if abs_x.size >= win and win > 1:
        left = (win - 1) // 2
        right = win - 1 - left
        padded = np.pad(abs_x.astype(np.float64), (left + 1, right), mode="constant")
        csum = np.cumsum(padded)
        env = ((csum[win:] - csum[:-win]) / float(win)).astype(np.float32)
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


def assemble_chunk_pcms(
    chunk_pcms: list[np.ndarray],
    sample_rate: int,
    *,
    chunk_pause_sec: float = 0.12,
) -> np.ndarray:
    chunk_pause = np.zeros(int(round(chunk_pause_sec * sample_rate)), dtype=np.float32)
    parts: list[np.ndarray] = []
    for trimmed in chunk_pcms:
        if trimmed.size > 0:
            if parts and chunk_pause.size > 0:
                parts.append(chunk_pause)
            parts.append(trimmed)
    if not parts:
        return np.zeros(int(0.3 * sample_rate), dtype=np.float32)
    return parts[0] if len(parts) == 1 else np.concatenate(parts)


class _CudaBatchRunner:
    """Runs Supertonic 3 ONNX inference on CUDA GPU 0 with IOBinding so latents stay in VRAM across diffusion steps."""

    def __init__(self, tts: Any, voice_style: Any, steps: int) -> None:
        import onnxruntime as ort

        self._ort = ort
        self._model = tts.model
        self._voice_style = voice_style
        self._steps = steps
        self._dp_out = self._model.dp_ort.get_outputs()[0].name
        self._te_out = self._model.text_enc_ort.get_outputs()[0].name
        self._ve_out = self._model.vector_est_ort.get_outputs()[0].name
        self._voc_out = self._model.vocoder_ort.get_outputs()[0].name
        self._static_cache: dict[int, tuple[Any, Any, Any, list[Any]]] = {}

    def _get_static_gpu_tensors(self, bsz: int) -> tuple[Any, Any, Any, list[Any]]:
        cached = self._static_cache.get(bsz)
        if cached is not None:
            return cached
        ort = self._ort
        dp_np = (
            self._voice_style.dp
            if bsz == 1
            else np.repeat(self._voice_style.dp, bsz, axis=0)
        )
        ttl_np = (
            self._voice_style.ttl
            if bsz == 1
            else np.repeat(self._voice_style.ttl, bsz, axis=0)
        )
        ort_dp = ort.OrtValue.ortvalue_from_numpy(np.ascontiguousarray(dp_np), "cuda", 0)
        ort_ttl = ort.OrtValue.ortvalue_from_numpy(np.ascontiguousarray(ttl_np), "cuda", 0)
        ort_total = ort.OrtValue.ortvalue_from_numpy(
            np.full((bsz,), float(self._steps), dtype=np.float32), "cuda", 0
        )
        step_vals = [
            ort.OrtValue.ortvalue_from_numpy(
                np.full((bsz,), float(s), dtype=np.float32), "cuda", 0
            )
            for s in range(self._steps)
        ]
        cached = (ort_dp, ort_ttl, ort_total, step_vals)
        self._static_cache[bsz] = cached
        return cached

    def run_batch(
        self, text_list: list[str], *, speed: float
    ) -> tuple[np.ndarray, np.ndarray]:
        ort = self._ort
        model = self._model
        bsz = len(text_list)
        text_ids, text_mask = model.text_processor(text_list, "ko")

        ort_dp, ort_ttl, ort_total, step_vals = self._get_static_gpu_tensors(bsz)
        ort_text_ids = ort.OrtValue.ortvalue_from_numpy(
            np.ascontiguousarray(text_ids), "cuda", 0
        )
        ort_text_mask = ort.OrtValue.ortvalue_from_numpy(
            np.ascontiguousarray(text_mask), "cuda", 0
        )

        dp_io = model.dp_ort.io_binding()
        dp_io.bind_ortvalue_input("text_ids", ort_text_ids)
        dp_io.bind_ortvalue_input("style_dp", ort_dp)
        dp_io.bind_ortvalue_input("text_mask", ort_text_mask)
        dp_io.bind_output(self._dp_out, "cpu")
        model.dp_ort.run_with_iobinding(dp_io)
        dur_onnx = dp_io.get_outputs()[0].numpy() / speed

        te_io = model.text_enc_ort.io_binding()
        te_io.bind_ortvalue_input("text_ids", ort_text_ids)
        te_io.bind_ortvalue_input("style_ttl", ort_ttl)
        te_io.bind_ortvalue_input("text_mask", ort_text_mask)
        te_io.bind_output(self._te_out, "cuda", 0)
        model.text_enc_ort.run_with_iobinding(te_io)
        ort_text_emb = te_io.get_outputs()[0]

        xt_np, latent_mask_np = model.sample_noisy_latent(dur_onnx)
        ort_xt = ort.OrtValue.ortvalue_from_numpy(np.ascontiguousarray(xt_np), "cuda", 0)
        ort_latent_mask = ort.OrtValue.ortvalue_from_numpy(
            np.ascontiguousarray(latent_mask_np), "cuda", 0
        )

        for s in range(self._steps):
            ve_io = model.vector_est_ort.io_binding()
            ve_io.bind_ortvalue_input("noisy_latent", ort_xt)
            ve_io.bind_ortvalue_input("text_emb", ort_text_emb)
            ve_io.bind_ortvalue_input("style_ttl", ort_ttl)
            ve_io.bind_ortvalue_input("text_mask", ort_text_mask)
            ve_io.bind_ortvalue_input("latent_mask", ort_latent_mask)
            ve_io.bind_ortvalue_input("current_step", step_vals[s])
            ve_io.bind_ortvalue_input("total_step", ort_total)
            ve_io.bind_output(self._ve_out, "cuda", 0)
            model.vector_est_ort.run_with_iobinding(ve_io)
            ort_xt = ve_io.get_outputs()[0]

        voc_io = model.vocoder_ort.io_binding()
        voc_io.bind_ortvalue_input("latent", ort_xt)
        voc_io.bind_output(self._voc_out, "cpu")
        model.vocoder_ort.run_with_iobinding(voc_io)
        wav = voc_io.get_outputs()[0].numpy()
        return wav, dur_onnx


def _create_batch_runner(
    tts: Any, voice_style: Any, steps: int
) -> _CudaBatchRunner | None:
    if "CUDAExecutionProvider" in get_active_tts_providers(tts):
        return _CudaBatchRunner(tts, voice_style, steps)
    return None


def _get_batched_style(voice_style: Any, bsz: int, style_cache: dict[int, Any]) -> Any:
    cached = style_cache.get(bsz)
    if cached is not None:
        return cached
    if bsz == 1:
        batch_style = voice_style
    else:
        from supertonic.core import Style

        batch_style = Style(
            np.repeat(voice_style.ttl, bsz, axis=0),
            np.repeat(voice_style.dp, bsz, axis=0),
        )
    style_cache[bsz] = batch_style
    return batch_style


def _run_single_batch(
    tts: Any,
    voice_style: Any,
    batch_texts: list[str],
    *,
    steps: int,
    speed: float,
    use_batched_model: bool,
    cuda_runner: _CudaBatchRunner | None,
    style_cache: dict[int, Any],
) -> tuple[np.ndarray, np.ndarray]:
    if cuda_runner is not None:
        return cuda_runner.run_batch(batch_texts, speed=speed)
    if use_batched_model:
        batch_style = _get_batched_style(voice_style, len(batch_texts), style_cache)
        return tts.model(
            batch_texts,
            batch_style,
            total_step=steps,
            speed=speed,
            lang="ko",
        )
    wav_single, dur_single = tts.synthesize(
        text=batch_texts[0],
        voice_style=voice_style,
        total_steps=steps,
        speed=speed,
        max_chunk_length=max(200, len(batch_texts[0]) + 20),
        silence_duration=0.0,
        lang="ko",
    )
    return (
        np.asarray(wav_single, dtype=np.float32).reshape(1, -1),
        np.asarray(dur_single, dtype=np.float32).reshape(1),
    )


def synthesize_chunks_raw_batched(
    tts: Any,
    voice_style: Any,
    chunks: list[str],
    *,
    steps: int,
    speed: float,
    batch_size: int,
    cuda_runner: _CudaBatchRunner | None = None,
) -> list[np.ndarray]:
    if not chunks:
        return []
    sample_rate = int(tts.sample_rate)

    if batch_size <= 1:
        pcms: list[np.ndarray] = []
        for chunk in chunks:
            wav_batch, _ = _run_single_batch(
                tts,
                voice_style,
                [chunk],
                steps=steps,
                speed=speed,
                use_batched_model=False,
                cuda_runner=None,
                style_cache={},
            )
            pcms.append(wav_batch.reshape(-1))
        return pcms

    # Bucket by character length so mini-batches have minimal padding overhead.
    order = sorted(range(len(chunks)), key=lambda idx: len(chunks[idx]))
    results: list[np.ndarray | None] = [None] * len(chunks)
    style_cache: dict[int, Any] = {}
    active_cuda = (
        cuda_runner
        if cuda_runner is not None
        else _create_batch_runner(tts, voice_style, steps)
    )

    for start in range(0, len(order), batch_size):
        batch_indices = order[start : start + batch_size]
        batch_texts = [chunks[i] for i in batch_indices]
        wav_batch, dur_batch = _run_single_batch(
            tts,
            voice_style,
            batch_texts,
            steps=steps,
            speed=speed,
            use_batched_model=True,
            cuda_runner=active_cuda,
            style_cache=style_cache,
        )
        for row_idx, orig_idx in enumerate(batch_indices):
            n_samples = max(1, int(round(float(dur_batch[row_idx]) * sample_rate)))
            results[orig_idx] = np.array(
                wav_batch[row_idx, :n_samples], dtype=np.float32, copy=True
            )

    return [pcm if pcm is not None else np.zeros(0, dtype=np.float32) for pcm in results]


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
    *,
    quality: int = 2,
) -> int:
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate_kbps)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(quality)
    encoder.set_vbr(0)
    encoder.silence()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.mp3.tmp")
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


def finalize_chapter_from_raw_chunks(
    raw_chunk_pcms: list[np.ndarray],
    sr: int,
    *,
    usfm: str,
    chapter: int,
    verses: list[VerseJob],
    header_text: str,
    cfg: SynthConfig,
    mp3_path: Path,
) -> tuple[dict[str, float], dict[str, Any]]:
    trimmed_pcms = [trim_silence(pcm, sr) for pcm in raw_chunk_pcms]
    header_pcm = assemble_chunk_pcms(trimmed_pcms[0:1], sr)
    chunk_cursor = 1
    header_pause = np.zeros(int(round(cfg.header_pause_sec * sr)), dtype=np.float32)
    verse_pause = np.zeros(int(round(cfg.verse_pause_sec * sr)), dtype=np.float32)

    segments: list[np.ndarray] = [header_pcm, header_pause]
    sample_cursor = int(header_pcm.size + header_pause.size)
    timings: dict[str, float] = {}
    prev_start = -1.0

    for idx, v in enumerate(verses):
        num_chunks = len(v.chunks)
        verse_pcm = assemble_chunk_pcms(
            trimmed_pcms[chunk_cursor : chunk_cursor + num_chunks],
            sr,
        )
        chunk_cursor += num_chunks
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
    if not verses or not timings:
        raise RuntimeError(f"{usfm} {chapter}: no synthesized verse timings produced")
    last_start = timings[str(verses[-1].verse)]
    if last_start >= total_duration:
        raise RuntimeError(
            f"{usfm} {chapter}: invalid final timestamp {last_start} >= duration {total_duration:.3f}s"
        )

    mp3_bytes = encode_cbr_mp3(
        mastered,
        sr,
        cfg.bitrate_kbps,
        mp3_path,
        quality=cfg.mp3_quality,
    )

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
    cuda_runner: _CudaBatchRunner | None = None,
) -> tuple[dict[str, float], dict[str, Any]]:
    sr = int(tts.sample_rate)
    header_text = format_chapter_header(usfm, book_ko, chapter)
    all_chunks = [header_text, *[chunk for v in verses for chunk in v.chunks]]
    raw_chunk_pcms = synthesize_chunks_raw_batched(
        tts,
        voice_style,
        all_chunks,
        steps=cfg.steps,
        speed=cfg.speed,
        batch_size=cfg.batch_size,
        cuda_runner=cuda_runner,
    )
    return finalize_chapter_from_raw_chunks(
        raw_chunk_pcms,
        sr,
        usfm=usfm,
        chapter=chapter,
        verses=verses,
        header_text=header_text,
        cfg=cfg,
        mp3_path=mp3_path,
    )


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


_ORIG_LOAD_ONNX_MODULES: Any = None


def configure_onnx_providers(
    requested_device: str,
    *,
    verbose: bool = False,
) -> tuple[str, list[str]]:
    global _ORIG_LOAD_ONNX_MODULES
    import onnxruntime as ort
    import supertonic.config as st_config
    import supertonic.loader as st_loader

    if not verbose and hasattr(ort, "set_default_logger_severity"):
        # Suppress non-fatal ONNX Runtime warnings (e.g. transformer_memcpy graph notices).
        ort.set_default_logger_severity(3)

    available = list(ort.get_available_providers())
    has_cuda = "CUDAExecutionProvider" in available

    if requested_device in ("auto", "cuda") and has_cuda and hasattr(ort, "preload_dlls"):
        try:
            ort.preload_dlls()
        except Exception as err:  # noqa: BLE001
            print(
                f"Warning: onnxruntime.preload_dlls() failed: {err}",
                file=sys.stderr,
                flush=True,
            )

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

    if _ORIG_LOAD_ONNX_MODULES is None:
        _ORIG_LOAD_ONNX_MODULES = st_loader.load_onnx_modules

    if active_device == "cuda":
        # Use HEURISTIC cuDNN search + max workspace to avoid slow EXHAUSTIVE search on dynamic sequence shapes.
        def _load_onnx_modules_cuda(
            model_dir: Path | str,
            intra_op_num_threads: int | None = None,
            inter_op_num_threads: int | None = None,
        ) -> tuple[Any, Any, Any, Any]:
            model_root = Path(model_dir)
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            if intra_op_num_threads is not None:
                opts.intra_op_num_threads = intra_op_num_threads
            if inter_op_num_threads is not None:
                opts.inter_op_num_threads = inter_op_num_threads

            provider_candidates: tuple[list[Any], ...] = (
                [
                    (
                        "CUDAExecutionProvider",
                        {
                            "device_id": "0",
                            "cudnn_conv_algo_search": "HEURISTIC",
                            "cudnn_conv_use_max_workspace": "1",
                        },
                    ),
                    "CPUExecutionProvider",
                ],
                [
                    ("CUDAExecutionProvider", {"device_id": "0"}),
                    "CPUExecutionProvider",
                ],
            )
            rel_paths = (
                st_config.DP_ONNX_REL_PATH,
                st_config.TEXT_ENC_ONNX_REL_PATH,
                st_config.VECTOR_EST_ONNX_REL_PATH,
                st_config.VOCODER_ONNX_REL_PATH,
            )
            for providers in provider_candidates:
                try:
                    return tuple(  # type: ignore[return-value]
                        ort.InferenceSession(
                            model_root / rel, sess_options=opts, providers=providers
                        )
                        for rel in rel_paths
                    )
                except Exception:  # noqa: BLE001
                    continue
            return _ORIG_LOAD_ONNX_MODULES(
                model_root, intra_op_num_threads, inter_op_num_threads
            )

        st_loader.load_onnx_modules = _load_onnx_modules_cuda
    else:
        st_loader.load_onnx_modules = _ORIG_LOAD_ONNX_MODULES

    return active_device, available


def get_active_tts_providers(tts: Any) -> list[str]:
    model = getattr(tts, "model", None)
    for attr in ("vocoder_ort", "vector_est_ort", "text_enc_ort", "dp_ort"):
        session = getattr(model, attr, None)
        if session is not None and hasattr(session, "get_providers"):
            return list(session.get_providers())
    return []


def _check_cuda_provider(
    providers: list[str],
    requested_device: str,
    context: str,
    fallback_note: str,
) -> bool:
    if "CUDAExecutionProvider" in providers:
        return True
    msg = f"{context} failed to bind CUDAExecutionProvider (active={providers})."
    if requested_device == "cuda":
        raise RuntimeError(msg)
    print(f"Warning: {msg} {fallback_note}", file=sys.stderr, flush=True)
    return False


def verify_environment(requested_device: str, *, verbose: bool = False) -> int:
    active_device, available = configure_onnx_providers(requested_device, verbose=verbose)
    print(f"ONNX_DEVICE={active_device}", flush=True)
    print(f"REMOTE_PROVIDERS={','.join(available)}", flush=True)
    from supertonic.loader import (
        download_model,
        get_cache_dir,
        has_all_onnx_modules,
        list_available_voice_style_names,
    )

    model_dir = get_cache_dir("supertonic-3")
    if not has_all_onnx_modules(model_dir):
        download_model(model_dir, "supertonic-3")
    voices = list_available_voice_style_names(model_dir)
    print(f"REMOTE_VOICES={','.join(voices)}", flush=True)
    return 0


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
        "--mp3-quality",
        type=int,
        default=5,
        choices=range(0, 10),
        help="LAME MP3 encoding quality 0 (best/slowest) to 9 (fastest) (default: 5)",
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
        help="CPU worker processes (default: 0 = auto, up to 6)",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=2,
        help="ONNX intra-op threads per worker process (default: 2)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=0,
        help="Chunks synthesized per ONNX call (default: 0 = auto: 64 on CUDA, 1 on CPU)",
    )
    parser.add_argument(
        "--gpu-streams",
        type=int,
        default=0,
        help="Concurrent CUDA ONNX sessions on GPU 0 (default: 0 = auto: 2 for >=12 chapters, else 1)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show ONNX Runtime warning logs at startup",
    )
    parser.add_argument(
        "--verify-env",
        action="store_true",
        help="Verify ONNX Runtime providers and Supertonic 3 weights without synthesizing",
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
    args = parser.parse_args()
    checks = (
        (args.speed > 0, "--speed must be > 0"),
        (args.steps >= 1, "--steps must be >= 1"),
        (args.pause >= 0, "--pause must be >= 0"),
        (args.header_pause >= 0, "--header-pause must be >= 0"),
        (args.bitrate >= 32, "--bitrate must be >= 32"),
        (args.workers >= 0, "--workers must be >= 0"),
        (args.threads >= 1, "--threads must be >= 1"),
        (args.gpu_streams >= 0, "--gpu-streams must be >= 0"),
        (args.batch_size >= 0, "--batch-size must be >= 0"),
    )
    for ok, err_msg in checks:
        if not ok:
            parser.error(err_msg)
    return args


def _init_worker(resolved_voice: str, intra_threads: int, verbose: bool) -> None:
    global _WORKER_TTS, _WORKER_STYLE
    configure_onnx_providers("cpu", verbose=verbose)
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
    job: ChapterJob,
    cfg: SynthConfig,
    cuda_runner: _CudaBatchRunner | None = None,
) -> tuple[str, int, int, dict[str, float], dict[str, Any], float]:
    mp3_path = cfg.audio_dir / job.usfm / f"{job.chapter}.mp3"
    t0 = time.time()
    try:
        timings, metrics = synthesize_chapter(
            tts,
            voice_style,
            usfm=job.usfm,
            book_ko=job.book_ko,
            chapter=job.chapter,
            verses=job.verses,
            cfg=cfg,
            mp3_path=mp3_path,
            cuda_runner=cuda_runner,
        )
        return job.usfm, job.chapter, job.total_verses, timings, metrics, time.time() - t0
    finally:
        gc.collect()


def _process_chapter_job(
    job: ChapterJob,
    cfg: SynthConfig,
) -> tuple[str, int, int, dict[str, float], dict[str, Any], float]:
    return _synthesize_job(_WORKER_TTS, _WORKER_STYLE, job, cfg)


def collect_chapter_jobs(
    args: argparse.Namespace,
    catalog: dict[str, tuple[int, str]],
    timings_dir: Path,
    audio_dir: Path,
) -> tuple[list[dict[str, Any]], list[ChapterJob], int, int, int, bool]:
    book_names_ko = {usfm: ko for usfm, (_, ko) in catalog.items()}

    manifest_chapters: dict[str, set[int]] | None = None
    if args.job_manifest is not None:
        wanted_usfms, manifest_chapters = load_job_manifest(args.job_manifest, catalog)
        selected_books = load_krv_books(wanted_usfms) if wanted_usfms else []
    else:
        wanted_usfms = resolve_requested_usfms(args, catalog)
        selected_books = load_krv_books(wanted_usfms)

    chapter_filter: set[int] | None = None
    if args.chapters:
        try:
            chapter_filter = {
                int(c.strip()) for c in str(args.chapters).split(",") if c.strip()
            }
        except ValueError as err:
            raise SystemExit(f"Invalid --chapters value: {args.chapters!r}") from err

    jobs: list[ChapterJob] = []
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
            if (
                allowed_manifest_chapters is not None
                and ch_num not in allowed_manifest_chapters
            ):
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
            jobs.append(
                ChapterJob(
                    usfm=usfm,
                    book_ko=book_ko,
                    chapter=ch_num,
                    verses=verses,
                    total_verses=len(raw_verses),
                )
            )

    preserve_existing_timings = (
        not args.force or chapter_filter is not None or manifest_chapters is not None
    )
    return (
        selected_books,
        jobs,
        total_verses_checked,
        total_chunks,
        max_chunk_len,
        preserve_existing_timings,
    )


def validate_jobs_text(jobs: list[ChapterJob], text_processor: Any) -> None:
    """Validate every selected chapter header and verse against Supertonic's character table."""
    for job in jobs:
        header = format_chapter_header(job.usfm, job.book_ko, job.chapter)
        ok, bad = text_processor.validate_text(header)
        if not ok:
            raise RuntimeError(f"Unsupported chars in header {job.usfm} {job.chapter}: {bad}")
        for v in job.verses:
            ok, bad = text_processor.validate_text(v.spoken_text)
            if not ok:
                raise RuntimeError(
                    f"Unsupported chars in {job.usfm} {job.chapter}:{v.verse}: {bad}"
                )


class ChapterRecorder:
    """Tracks per-chapter synthesis results and flushes per-book timing JSONs + report incrementally."""

    def __init__(
        self,
        jobs: list[ChapterJob],
        timings_dir: Path,
        report_path: Path,
        *,
        preserve_existing_timings: bool,
    ) -> None:
        self.total_jobs = len(jobs)
        self.timings_dir = timings_dir
        self.report_path = report_path
        self.preserve_existing_timings = preserve_existing_timings
        self.started_at = time.time()
        self.completed = 0
        self.errors = 0
        self._book_cache: dict[str, dict[str, Any]] = {}
        self._dirty_books: set[str] = set()
        self._remaining_by_book: dict[str, int] = {}
        for job in jobs:
            self._remaining_by_book[job.usfm] = self._remaining_by_book.get(job.usfm, 0) + 1

        report: dict[str, Any] = {}
        if report_path.exists():
            try:
                with report_path.open("r", encoding="utf-8") as fh:
                    loaded = json.load(fh)
                if isinstance(loaded, dict):
                    report = loaded
            except Exception:  # noqa: BLE001
                report = {}
        self.report = report
        self.chapters_report: dict[str, Any] = report.setdefault("chapters", {})

    def _get_book_payload(self, usfm: str) -> dict[str, Any]:
        if usfm not in self._book_cache:
            out_path = self.timings_dir / f"{usfm}.json"
            if not self.preserve_existing_timings and usfm not in self._dirty_books:
                self._book_cache[usfm] = empty_book_timings(usfm)
            else:
                self._book_cache[usfm] = load_existing_book_timings(out_path, usfm)
        return self._book_cache[usfm]

    def _flush_book(self, usfm: str) -> None:
        if usfm not in self._dirty_books:
            return
        payload = self._book_cache[usfm]
        payload["audioSource"] = AUDIO_SOURCE_ID
        payload["chapters"] = {
            k: payload["chapters"][k] for k in sorted(payload["chapters"].keys(), key=int)
        }
        atomic_write_json(self.timings_dir / f"{usfm}.json", payload, compact=True)
        self._dirty_books.discard(usfm)

    def record_success(
        self,
        idx_done: int,
        usfm: str,
        ch_num: int,
        total_verses: int,
        timings: dict[str, float],
        metrics: dict[str, Any],
        elapsed: float,
    ) -> None:
        ref = f"{usfm}:{ch_num}"
        book_payload = self._get_book_payload(usfm)
        book_payload["chapters"][str(ch_num)] = timings
        self._dirty_books.add(usfm)

        self.chapters_report[ref] = {
            "status": "ok",
            "totalVerses": total_verses,
            "wallSeconds": round(elapsed, 2),
            **metrics,
        }
        self.completed += 1
        self._remaining_by_book[usfm] = max(0, self._remaining_by_book.get(usfm, 1) - 1)
        print(
            f"[{idx_done}/{self.total_jobs}] {ref} "
            f"({metrics['versesSynthesized']}/{total_verses} vv, "
            f"{metrics['duration']}s audio in {elapsed:.1f}s, "
            f"v1={metrics['v1Start']}s, {metrics['mp3Bytes'] // 1024} KB)",
            flush=True,
        )

        if self._remaining_by_book[usfm] == 0:
            self._flush_book(usfm)
        elif self.completed % 10 == 0:
            for dirty_usfm in list(self._dirty_books):
                self._flush_book(dirty_usfm)
        if self._remaining_by_book[usfm] == 0 or self.completed % 10 == 0:
            atomic_write_json(self.report_path, self.report, compact=False)

    def record_error(self, idx_done: int, usfm: str, ch_num: int, err: Exception) -> None:
        self.errors += 1
        self._remaining_by_book[usfm] = max(0, self._remaining_by_book.get(usfm, 1) - 1)
        self.chapters_report[f"{usfm}:{ch_num}"] = {"status": "error", "error": str(err)}
        print(
            f"[{idx_done}/{self.total_jobs}] {usfm}:{ch_num} — ERROR: {err}",
            file=sys.stderr,
            flush=True,
        )

    def run_step(
        self,
        idx_done: int,
        usfm: str,
        ch_num: int,
        fn: Callable[[], tuple[str, int, int, dict[str, float], dict[str, Any], float]],
    ) -> None:
        try:
            res_usfm, res_ch, total_verses, timings, metrics, elapsed = fn()
            self.record_success(
                idx_done, res_usfm, res_ch, total_verses, timings, metrics, elapsed
            )
        except Exception as err:  # noqa: BLE001
            self.record_error(idx_done, usfm, ch_num, err)

    def flush_and_write_summary(self, meta: dict[str, Any]) -> None:
        for dirty_usfm in list(self._dirty_books):
            self._flush_book(dirty_usfm)
        self.report["summary"] = {
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            **meta,
            "completedInRun": self.completed,
            "errorsInRun": self.errors,
            "totalSeconds": round(time.time() - self.started_at, 1),
        }
        atomic_write_json(self.report_path, self.report, compact=False)


def _group_jobs_into_windows(
    jobs: list[ChapterJob], batch_size: int, encode_workers: int, num_runners: int
) -> list[list[ChapterJob]]:
    window_chunk_limit = (
        max(batch_size * max(4, num_runners * 2), 256) if batch_size > 1 else 1
    )
    window_chapter_limit = max(encode_workers, num_runners * 4) if batch_size > 1 else 1
    windows: list[list[ChapterJob]] = []
    cur_win: list[ChapterJob] = []
    cur_chunks = 0
    for job in jobs:
        j_chunks = job.chunk_count
        if cur_win and (
            cur_chunks + j_chunks > window_chunk_limit
            or len(cur_win) >= window_chapter_limit
            or batch_size <= 1
        ):
            windows.append(cur_win)
            cur_win = []
            cur_chunks = 0
        cur_win.append(job)
        cur_chunks += j_chunks
    if cur_win:
        windows.append(cur_win)
    return windows


def run_in_process_pipeline(
    jobs: list[ChapterJob],
    tts: Any,
    voice_style: Any,
    cfg: SynthConfig,
    recorder: ChapterRecorder,
    *,
    active_device: str,
    requested_device: str,
    threads: int,
    gpu_streams: int,
) -> None:
    sr = int(tts.sample_rate)
    cuda_runner = _create_batch_runner(tts, voice_style, cfg.steps)
    extra_tts_instances: list[Any] = []
    cuda_runners: list[_CudaBatchRunner] = [cuda_runner] if cuda_runner is not None else []

    if cuda_runner is not None and active_device == "cuda" and gpu_streams > 1:
        from supertonic import TTS

        for stream_idx in range(1, gpu_streams):
            extra_tts = TTS(
                model="supertonic-3",
                auto_download=False,
                intra_op_num_threads=threads,
                inter_op_num_threads=1,
            )
            if not _check_cuda_provider(
                get_active_tts_providers(extra_tts),
                requested_device,
                f"GPU 0 stream {stream_idx}",
                "Skipping runner.",
            ):
                continue
            extra_tts_instances.append(extra_tts)
            extra_runner = _create_batch_runner(extra_tts, voice_style, cfg.steps)
            if extra_runner is not None:
                cuda_runners.append(extra_runner)

    encode_workers = max(1, min(len(jobs), os.cpu_count() or 4))
    if encode_workers == 1 or len(jobs) == 1:
        for idx, job in enumerate(jobs, start=1):
            recorder.run_step(
                idx,
                job.usfm,
                job.chapter,
                lambda j=job: _synthesize_job(
                    tts, voice_style, j, cfg, cuda_runner=cuda_runner
                ),
            )
        del extra_tts_instances
        return

    max_in_flight = encode_workers * 2
    pending_futures: dict[Any, tuple[str, int]] = {}
    done_count = 0

    def _drain_one() -> None:
        nonlocal done_count
        done_set, _ = wait(pending_futures.keys(), return_when=FIRST_COMPLETED)
        for fut in done_set:
            usfm_f, ch_f = pending_futures.pop(fut)
            done_count += 1
            recorder.run_step(done_count, usfm_f, ch_f, fut.result)

    def _encode_raw_chapter(
        raw_pcms: list[np.ndarray],
        job: ChapterJob,
        header_t: str,
        t_start: float,
    ) -> tuple[str, int, int, dict[str, float], dict[str, Any], float]:
        mp3_path = cfg.audio_dir / job.usfm / f"{job.chapter}.mp3"
        final_timings, metrics = finalize_chapter_from_raw_chunks(
            raw_pcms,
            sr,
            usfm=job.usfm,
            chapter=job.chapter,
            verses=job.verses,
            header_text=header_t,
            cfg=cfg,
            mp3_path=mp3_path,
        )
        return (
            job.usfm,
            job.chapter,
            job.total_verses,
            final_timings,
            metrics,
            time.time() - t_start,
        )

    windows = _group_jobs_into_windows(
        jobs, cfg.batch_size, encode_workers, max(1, len(cuda_runners))
    )
    runner_queue: queue.Queue[_CudaBatchRunner] = queue.Queue()
    for r in cuda_runners:
        runner_queue.put(r)

    def _run_pooled_cuda_batch(b_texts: list[str]) -> tuple[np.ndarray, np.ndarray]:
        runner = runner_queue.get()
        try:
            return runner.run_batch(b_texts, speed=cfg.speed)
        finally:
            runner_queue.put(runner)

    with (
        ThreadPoolExecutor(max_workers=encode_workers) as encode_pool,
        ThreadPoolExecutor(max_workers=max(1, len(cuda_runners))) as gpu_pool,
    ):
        for win_jobs in windows:
            t_win_start = time.time()
            flat_texts: list[str] = []
            flat_meta: list[tuple[int, int]] = []
            chapter_headers: list[str] = []
            chapter_slots: list[list[np.ndarray | None]] = []
            chapter_remaining: list[int] = []
            chapter_started: list[float | None] = [None] * len(win_jobs)
            chapter_failed: list[bool] = [False] * len(win_jobs)

            for local_idx, job in enumerate(win_jobs):
                header_j = format_chapter_header(job.usfm, job.book_ko, job.chapter)
                chapter_headers.append(header_j)
                job_chunks = [header_j, *[c for v in job.verses for c in v.chunks]]
                chapter_slots.append([None] * len(job_chunks))
                chapter_remaining.append(len(job_chunks))
                for c_idx, txt in enumerate(job_chunks):
                    flat_texts.append(txt)
                    flat_meta.append((local_idx, c_idx))

            order = sorted(range(len(flat_texts)), key=lambda idx: len(flat_texts[idx]))
            style_cache: dict[int, Any] = {}
            step_bsz = max(1, cfg.batch_size)
            batches = [
                order[b_start : b_start + step_bsz]
                for b_start in range(0, len(order), step_bsz)
            ]

            def _scatter_batch_result(
                batch_indices: list[int],
                wav_batch: np.ndarray,
                dur_batch: np.ndarray,
                t_batch_start: float,
            ) -> None:
                for row_idx, flat_idx in enumerate(batch_indices):
                    local_idx, c_idx = flat_meta[flat_idx]
                    if chapter_failed[local_idx]:
                        continue
                    if chapter_started[local_idx] is None:
                        chapter_started[local_idx] = t_batch_start
                    n_samples = max(1, int(round(float(dur_batch[row_idx]) * sr)))
                    chapter_slots[local_idx][c_idx] = np.array(
                        wav_batch[row_idx, :n_samples],
                        dtype=np.float32,
                        copy=True,
                    )
                    chapter_remaining[local_idx] -= 1
                    if chapter_remaining[local_idx] == 0:
                        job = win_jobs[local_idx]
                        raw_pcms = [
                            p if p is not None else np.zeros(0, dtype=np.float32)
                            for p in chapter_slots[local_idx]
                        ]
                        chapter_slots[local_idx] = []
                        fut = encode_pool.submit(
                            _encode_raw_chapter,
                            raw_pcms,
                            job,
                            chapter_headers[local_idx],
                            chapter_started[local_idx] or t_win_start,
                        )
                        pending_futures[fut] = (job.usfm, job.chapter)
                        if len(pending_futures) >= max_in_flight:
                            _drain_one()

            def _fail_batch_chapters(batch_indices: list[int], err: Exception) -> None:
                nonlocal done_count
                affected = {flat_meta[flat_idx][0] for flat_idx in batch_indices}
                for local_idx in sorted(affected):
                    if chapter_failed[local_idx] or chapter_remaining[local_idx] == 0:
                        continue
                    chapter_failed[local_idx] = True
                    chapter_slots[local_idx] = []
                    job = win_jobs[local_idx]
                    done_count += 1
                    recorder.record_error(done_count, job.usfm, job.chapter, err)

            if len(cuda_runners) > 1 and len(batches) > 1:
                gpu_futs = {
                    gpu_pool.submit(
                        _run_pooled_cuda_batch,
                        [flat_texts[i] for i in batch_indices],
                    ): batch_indices
                    for batch_indices in batches
                }
                for gpu_fut in as_completed(gpu_futs):
                    batch_indices = gpu_futs[gpu_fut]
                    try:
                        wav_batch, dur_batch = gpu_fut.result()
                    except Exception as err:  # noqa: BLE001
                        _fail_batch_chapters(batch_indices, err)
                        continue
                    _scatter_batch_result(batch_indices, wav_batch, dur_batch, t_win_start)
            else:
                for batch_indices in batches:
                    t_batch = time.time()
                    batch_texts = [flat_texts[i] for i in batch_indices]
                    try:
                        wav_batch, dur_batch = _run_single_batch(
                            tts,
                            voice_style,
                            batch_texts,
                            steps=cfg.steps,
                            speed=cfg.speed,
                            use_batched_model=step_bsz > 1,
                            cuda_runner=cuda_runner,
                            style_cache=style_cache,
                        )
                    except Exception as err:  # noqa: BLE001
                        _fail_batch_chapters(batch_indices, err)
                        continue
                    _scatter_batch_result(batch_indices, wav_batch, dur_batch, t_batch)
        while pending_futures:
            _drain_one()
    del extra_tts_instances


def run_cpu_workers(
    jobs: list[ChapterJob],
    cfg: SynthConfig,
    recorder: ChapterRecorder,
    *,
    worker_count: int,
    resolved_voice: str,
    threads: int,
    verbose: bool,
) -> None:
    with ProcessPoolExecutor(
        max_workers=worker_count,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=_init_worker,
        initargs=(resolved_voice, threads, verbose),
    ) as executor:
        future_to_ref = {
            executor.submit(_process_chapter_job, job, cfg): (job.usfm, job.chapter)
            for job in jobs
        }
        for done_idx, future in enumerate(as_completed(future_to_ref), start=1):
            usfm, ch_num = future_to_ref[future]
            recorder.run_step(done_idx, usfm, ch_num, future.result)


def main() -> int:
    args = parse_args()
    if args.verify_env:
        return verify_environment(args.device, verbose=args.verbose)

    catalog = load_book_catalog()
    book_names_ko = {usfm: ko for usfm, (_, ko) in catalog.items()}
    (
        selected_books,
        jobs,
        total_verses_checked,
        total_chunks,
        max_chunk_len,
        preserve_existing_timings,
    ) = collect_chapter_jobs(args, catalog, args.timings_dir, args.audio_dir)

    if args.dry_run:
        sample_headers = [
            format_chapter_header(
                str(b["usfm"]),
                book_names_ko[str(b["usfm"])],
                int(next(iter(sorted(b["chapters"].keys(), key=int)))),
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

    active_device, available_providers = configure_onnx_providers(
        args.device, verbose=args.verbose
    )
    if active_device == "cuda":
        # 1 CUDA process + background CPU MP3 threadpool avoids multi-worker GPU proxy contention.
        worker_count = 1
    elif args.workers > 0:
        worker_count = max(1, min(args.workers, len(jobs)))
    else:
        cpu_count = os.cpu_count() or 6
        worker_count = (
            1 if len(jobs) <= 2 else min(6, max(1, cpu_count // max(1, args.threads)))
        )
        worker_count = max(1, min(worker_count, len(jobs)))

    tts: Any = None
    active_providers: list[str]
    if worker_count == 1:
        from supertonic import TTS

        tts = TTS(
            model="supertonic-3",
            auto_download=True,
            intra_op_num_threads=args.threads,
            inter_op_num_threads=1,
        )
        active_providers = get_active_tts_providers(tts)
        if active_device == "cuda" and not _check_cuda_provider(
            active_providers,
            args.device,
            f"ONNX session (available={available_providers})",
            "Falling back to CPU.",
        ):
            active_device = "cpu"
        voice_names = list(tts.voice_style_names)
        text_processor = tts.model.text_processor
    else:
        # Avoid loading unused ONNX sessions in the parent before spawning CPU workers.
        from supertonic.loader import (
            download_model,
            get_cache_dir,
            has_all_onnx_modules,
            list_available_voice_style_names,
            load_text_processor,
        )

        model_dir = get_cache_dir("supertonic-3")
        if not has_all_onnx_modules(model_dir):
            download_model(model_dir, "supertonic-3")
        voice_names = list_available_voice_style_names(model_dir)
        text_processor = load_text_processor(model_dir)
        active_providers = ["CPUExecutionProvider"]

    resolved_voice = resolve_voice_name(args.voice, voice_names)
    batch_size = args.batch_size if args.batch_size > 0 else (64 if active_device == "cuda" else 1)
    if active_device == "cuda":
        gpu_streams = (
            max(1, min(args.gpu_streams, 4))
            if args.gpu_streams > 0
            else (2 if len(jobs) >= 12 else 1)
        )
    else:
        gpu_streams = 1

    validate_jobs_text(jobs, text_processor)

    gpu_info = f"gpu_streams={gpu_streams}, " if active_device == "cuda" else ""
    print(
        f"Generating {len(jobs)} chapter(s) across {len(selected_books)} book(s) "
        f"using Supertonic 3 voice '{args.voice}' ({resolved_voice}), "
        f"device={active_device} ({','.join(active_providers) or 'unknown'}), "
        f"workers={worker_count}, {gpu_info}batch_size={batch_size}, "
        f"threads={args.threads}, speed={args.speed}, steps={args.steps}, "
        f"bitrate={args.bitrate}kbps, mp3_quality={args.mp3_quality}...",
        flush=True,
    )

    cfg = SynthConfig(
        steps=args.steps,
        speed=args.speed,
        verse_pause_sec=args.pause,
        header_pause_sec=args.header_pause,
        bitrate_kbps=args.bitrate,
        audio_dir=args.audio_dir,
        batch_size=batch_size,
        mp3_quality=args.mp3_quality,
    )
    recorder = ChapterRecorder(
        jobs,
        args.timings_dir,
        args.report_path,
        preserve_existing_timings=preserve_existing_timings,
    )

    try:
        if worker_count == 1:
            run_in_process_pipeline(
                jobs,
                tts,
                tts.get_voice_style(resolved_voice),
                cfg,
                recorder,
                active_device=active_device,
                requested_device=args.device,
                threads=args.threads,
                gpu_streams=gpu_streams,
            )
        else:
            run_cpu_workers(
                jobs,
                cfg,
                recorder,
                worker_count=worker_count,
                resolved_voice=resolved_voice,
                threads=args.threads,
                verbose=args.verbose,
            )
    finally:
        recorder.flush_and_write_summary(
            {
                "voice": args.voice,
                "resolvedVoice": resolved_voice,
                "device": active_device,
                "onnxProviders": active_providers,
                "workers": worker_count,
                "gpuStreams": gpu_streams,
                "batchSize": batch_size,
                "threads": args.threads,
                "speed": args.speed,
                "steps": args.steps,
                "bitrateKbps": args.bitrate,
                "mp3Quality": args.mp3_quality,
            }
        )

    print(
        f"Done in {time.time() - recorder.started_at:.1f}s: "
        f"{recorder.completed} generated, {recorder.errors} error(s). "
        f"Report: {args.report_path}",
        flush=True,
    )
    return 1 if recorder.errors > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
