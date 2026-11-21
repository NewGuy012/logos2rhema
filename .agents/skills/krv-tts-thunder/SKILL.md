---
name: krv-tts-thunder
description: >-
  Use this skill when generating, regenerating, benchmarking, or sizing Supertonic 3 KRV
  Korean Bible audio via `bun run audio:generate-krv`, Thunder Compute (`tnr`), or SSH.
  Provides measured GPU/VM time-and-cost matrices, Thunder platform limits, optimal
  sharding recommendations, and safety rules for full-Bible and book-level TTS runs.
---

# KRV Supertonic 3 TTS — Thunder Compute Sizing & Runbook

Use this reference to recommend the best GPU/VM configuration based on wall-clock time, cost, and scope whenever processing the KRV Bible (66 books, 1,189 chapters, 74.71 hrs of audio, 3.23 GB of 96 kbps CBR MP3s).

## Measured Baselines & Full-Bible Time/Cost Matrix

Derived from live Thunder Compute benchmarks (`RUT` 4 ch = `10.1s` synth at `q=5`; 20 real chapters `RUT,EST,JON,HAG` = 58.3 min audio in `38.5s` synth / `49.2s` E2E at `q=2`, and `29.7s` synth / `41.8s` E2E at `q=5`).

| Setup                                           | Total GPUs | Hourly Rate\* | Full-Bible Synth | Est. Total E2E\*\* | Est. Total Cost\* | Best For                                          |
| ----------------------------------------------- | ---------: | ------------: | ---------------: | -----------------: | ----------------: | ------------------------------------------------- |
| Local Mac (6 CPU workers)                       |          0 |         $0/hr |         ~4.3 hrs |           ~4.3 hrs |                $0 | Zero-cost offline fallback                        |
| `1×` VM · `1× A6000` (`q=2`, default)           |          1 |      $0.35/hr |       ~43–49 min |         ~50–60 min |      ~$0.30–$0.35 | Small/medium runs, max LAME quality               |
| `1×` VM · `1× A6000` (`q=5`)                    |          1 |      $0.35/hr |       ~33–38 min |         ~40–48 min |      ~$0.24–$0.28 | Cheapest single-VM full Bible                     |
| `1×` VM · `1× A6000` (`q=5 --steps 8`)          |          1 |      $0.35/hr |       ~28–32 min |         ~35–42 min |      ~$0.21–$0.25 | Lowest cost with Supertonic SDK default steps     |
| **`4×` VMs · `1× A6000` (`--shards 4`, `q=5`)** |      **4** |  **$1.40/hr** |       **~9 min** |     **~12–15 min** |  **~$0.30–$0.35** | **Best whole-Bible time/price sweet spot**        |
| **`8×` VMs · `1× A6000` (`--shards 8`, `q=5`)** |      **8** |  **$2.80/hr** |     **~4.5 min** |      **~8–10 min** |  **~$0.40–$0.50** | **Fastest whole Bible at low cost**               |
| `1×` VM · `4× A100 80GB` (`production`, `q=5`)  |          4 |     ~$4.36/hr |           ~9 min |         ~12–16 min |      ~$0.90–$1.15 | Fastest single-VM option                          |
| `2×` VMs · `4× A100 80GB` (`--shards 2`, `q=5`) |          8 |     ~$8.72/hr |           ~4 min |          ~8–10 min |      ~$1.15–$1.45 | Multi-VM + multi-GPU hybrid                       |
| `4×` VMs · `4× A100 80GB` (`--shards 4`, `q=5`) |         16 |    ~$17.44/hr |           ~2 min |           ~6–8 min |      ~$1.75–$2.30 | Absolute shortest wall time (high overhead share) |

\*Rates use Thunder Web UI pricing (`a6000` prototyping = `$0.35/hr`, `a100` = `$1.09/GPU-hr`, `h100` = `$3.20/GPU-hr`). Note: `tnr create` CLI has also displayed a lower `$0.08/hr` prototyping estimate; quote the conservative `$0.35/hr` rate when advising the user.  
\*\*Total E2E includes ~1.5–2 min parallel cold VM boot + `.venv`/weights bootstrap and ~1–4 min downloading 3.23 GB of MP3s (bounded by local internet speed, ~100–500 Mbps).

## Thunder Compute Constraints & Bottlenecks

- **GPU count per mode (`tnr create`):**
  - `--mode prototyping`: `a6000` supports **`1×` GPU only** (`8 vCPUs`, default saved in `DEFAULT_THUNDER_VM_SPEC`); `a100` / `h100` support `1–2×` GPUs.
  - `--mode production`: `a100` / `h100` only (`1–8×` GPUs); no `a6000`.
- **Why `--shards 4..8` of `1× A6000` beats multi-GPU `A100`:** Each `1× A6000` VM costs one-third as much per GPU-hour (`$0.35` vs `$1.09`) and brings 8 dedicated vCPUs for parallel LAME MP3 encoding (`~270×` RT capacity at `q=2`, `~700×` RT at `q=5`).
- **Diminishing returns past ~8 GPUs:** Fixed non-GPU overhead (~1.5–2 min cold VM boot/bootstrap + ~1–4 min 3.23 GB download) sets a ~4–5 min floor; scaling from 8 to 16 GPUs saves only ~2 min while tripling cost.
- **Built-in GPU/CPU optimizations (automatic):** CUDA ONNX provider patching, `IOBinding` VRAM pinning, `HEURISTIC` cuDNN search, cross-chapter length-bucketed batching (`batch_size=64`), auto dual CUDA streams on 1 GPU (`>=12` chapters), automatic multi-GPU `device_id` sharding (`--gpus`), `O(N)` `trim_silence`, async multi-vCPU MP3 threadpool, and uncompressed MP3 `rsync` pulls.

## Recommendations by Scenario

1. **Single book / small test (1–25 chapters):** Use **`1×` A6000** (`--create --delete-after`). Extra VMs don't pay off over ~10–30s runs.
   ```bash
   bun run audio:generate-krv --create --delete-after --book RUT --staging rut-test --mp3-quality 5 --force
   ```
2. **Whole Bible — best balance of time & cost (~12–15 min, ~$0.30–$0.35):** Use **4 parallel `1× A6000` shards** with `--mp3-quality 5 --delete-after`.
   ```bash
   # Preview character-weighted 4-shard split for free first:
   bun run audio:generate-krv --shards 4 --create --all --force --dry-run

   # Execute and auto-delete all 4 VMs after clean sync:
   bun run audio:generate-krv --shards 4 --create --mp3-quality 5 --delete-after --all
   ```
3. **Whole Bible — fastest low-cost option (~8–10 min, ~$0.40–$0.50):** Use **`--shards 8`** (`8×` `1× A6000` VMs, `--mp3-quality 5 --delete-after`).
4. **Whole Bible — cheapest single VM (~40–48 min, ~$0.24–$0.28):** Use **`1×` A6000** (`--create --mp3-quality 5 --delete-after --all`).

## Operational Safety Checklist

- **Always preview first** with `--dry-run` (both single-VM `--create --dry-run` and `--shards N --create --dry-run` print the exact plan without provisioning VMs).
- **Use `--staging <name>`** for tests so production audio (`.cache/krv-supertonic-audio/`), production timings (`public/data/timings/krv-supertonic/`), and `.cache/krv-r2-uploaded.json` are never touched.
- **R2 upload is opt-in only** (`--upload` is blocked in staging; standalone upload is `bun run audio:upload-krv`). Never upload to Cloudflare R2 unless explicitly requested.
- **Stop billing:** Prefer `--delete-after` for one-shot runs, and verify no VMs remain afterward with `tnr --json status --no-wait </dev/null` (always pass `stdin: "ignore"` / `</dev/null` to `tnr` to avoid interactive TUI hangs).
