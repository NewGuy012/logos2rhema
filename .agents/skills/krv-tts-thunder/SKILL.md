---
name: krv-tts-thunder
description: >-
  Use this skill when generating, regenerating, benchmarking, or sizing Supertonic 3 KRV
  Korean Bible audio via `bun run audio:generate-krv` or Thunder Compute (`tnr`).
  Provides measured GPU/VM time-and-cost matrices, Thunder platform limits, optimal
  sharding defaults, and safety rules for full-Bible and book-level TTS runs.
---

# KRV Supertonic 3 TTS — Thunder Compute Sizing & Runbook

Use this reference to recommend the best setup based on wall-clock time, cost, and scope whenever processing the KRV Bible (66 books, 1,189 chapters, 74.71 hrs of audio, 3.23 GB of 96 kbps CBR MP3s).

## Measured Baselines & Retained Sweet-Spot Matrix

Derived from live Thunder Compute benchmarks (`RUT` 4 ch = `10.1s` synth at `q=5`; 20 real chapters `RUT,EST,JON,HAG` = 58.3 min audio in `38.5s` synth / `49.2s` E2E at `q=2`, and `29.7s` synth / `41.8s` E2E at `q=5`).

`bun run audio:generate-krv` defaults every setting to the matrix sweet spot: local runs use **multi-core CPU (`<=6` workers, `q=5`)**, and `--create` runs provision **`1× A6000` (`8 vCPUs`, `prototyping`, `cuda12-8`, `100 GB`, `q=5`)** with auto-sized sharding (`1` for `<=25` ch, `2` for `26–150` ch, `4` for `>150` ch) and automatic VM deletion on clean sync.

| Setup                                                  | Total GPUs | Hourly Rate\* | Full-Bible Synth | Est. Total E2E\*\* | Est. Total Cost\* | Best For                                          |
| ------------------------------------------------------ | ---------: | ------------: | ---------------: | -----------------: | ----------------: | ------------------------------------------------- |
| Local Mac (`<=6` CPU workers, default local)           |          0 |         $0/hr |         ~4.3 hrs |           ~4.3 hrs |                $0 | Zero-cost offline fallback                        |
| `1×` VM · `1× A6000` (`--shards 1`, `q=5`)             |          1 |      $0.35/hr |       ~33–38 min |         ~40–48 min |      ~$0.24–$0.28 | Small tests (auto for `<=25` ch) or cheapest 1-VM |
| `1×` VM · `1× A6000` (`--mp3-quality 2`)               |          1 |      $0.35/hr |       ~43–49 min |         ~50–60 min |      ~$0.30–$0.35 | Max LAME quality when explicitly requested        |
| `1×` VM · `1× A6000` (`--steps 8`)                     |          1 |      $0.35/hr |       ~28–32 min |         ~35–42 min |      ~$0.21–$0.25 | Lowest cost with Supertonic SDK default steps     |
| **`4×` VMs · `1× A6000` (`--create`, auto `>150` ch)** |      **4** |  **$1.40/hr** |       **~9 min** |     **~12–15 min** |  **~$0.30–$0.35** | **Default whole-Bible time/price sweet spot**     |
| **`8×` VMs · `1× A6000` (`--shards 8`, `q=5`)**        |      **8** |  **$2.80/hr** |     **~4.5 min** |      **~8–10 min** |  **~$0.40–$0.50** | **Fastest low-cost whole Bible (max `--shards`)** |

\*Rates use conservative Thunder Web UI pricing (`a6000` prototyping = `$0.35/hr`). Note: `tnr create` CLI has also displayed a lower `$0.08/hr` prototyping estimate; quote `$0.35/hr` when advising the user.  
\*\*Total E2E includes ~1.5–2 min parallel cold VM boot + `.venv`/weights bootstrap and ~1–4 min downloading 3.23 GB of MP3s (bounded by local internet speed, ~100–500 Mbps).

## Thunder Compute Constraints & Bottlenecks

- **Standardized VM spec (`THUNDER_VM_SPEC` in `scripts/lib/thunder.ts`):** `--mode prototyping --gpu a6000 --vcpus 8 --template cuda12-8 --disk-size-gb 100` (`1×` RTX A6000 per VM). Multi-GPU single-VM `production` A100/H100 setups cost 3×–5× more per Bible without beating `4–8×` `1× A6000` shards.
- **Why `--shards 4..8` of `1× A6000` wins:** Each `1× A6000` VM costs one-third as much per GPU-hour (`$0.35` vs `$1.09` A100) and brings 8 dedicated vCPUs for parallel LAME MP3 encoding (`~700×` RT capacity at `q=5`).
- **Diminishing returns past 8 shards:** Fixed non-GPU overhead (~1.5–2 min cold VM boot/bootstrap + ~1–4 min 3.23 GB download) sets a ~4–5 min floor; `--shards` is capped at `1–8`.
- **Built-in GPU/CPU optimizations (automatic):** CUDA ONNX provider patching, `IOBinding` VRAM pinning, `HEURISTIC` cuDNN search, cross-chapter length-bucketed batching (`batch_size=64`), auto dual CUDA streams on GPU 0 (`>=12` chapters), `O(N)` `trim_silence`, async multi-vCPU MP3 threadpool, and uncompressed MP3 `rsync` pulls over SSH ControlMaster.

## Recommendations by Scenario

1. **Single book / small test (`1–25` chapters):** Auto-sizes to **`1×` A6000** (`--create` auto-deletes after sync).
   ```bash
   bun run audio:generate-krv --create --book RUT --staging rut-test --force
   ```
2. **Whole Bible — zero-config matrix sweet spot (`~12–15 min, ~$0.30–$0.35`):** `--create --all` automatically chooses **4 parallel `1× A6000` shards**, `q=5`, and auto-deletes all 4 VMs after clean sync.
   ```bash
   # Preview character-weighted 4-shard split for free first:
   bun run audio:generate-krv --create --all --force --dry-run

   # Execute and auto-delete all 4 VMs after clean sync:
   bun run audio:generate-krv --create --all
   ```
3. **Whole Bible — fastest low-cost option (`~8–10 min, ~$0.40–$0.50`):** Pass **`--shards 8`** (`8×` `1× A6000` VMs, auto-deleted).
   ```bash
   bun run audio:generate-krv --create --shards 8 --all
   ```
4. **Whole Bible — cheapest single VM (`~40–48 min, ~$0.24–$0.28`):** Pass **`--shards 1`**.
   ```bash
   bun run audio:generate-krv --create --shards 1 --all
   ```

## Operational Safety Checklist

- **Always preview first** with `--dry-run` (`--create --dry-run` never provisions billable VMs and prints the exact shard split + estimated hourly cost).
- **Use `--staging <name>`** for tests so production audio (`.cache/krv-supertonic-audio/`), production timings (`public/data/timings/krv-supertonic/`), and `.cache/krv-r2-uploaded.json` are never touched.
- **R2 upload is always separate:** `audio:generate-krv` never uploads to R2; standalone upload is `bun run audio:upload-krv`. Never upload to Cloudflare R2 unless explicitly requested.
- **Stop billing:** `--create` VMs auto-delete after clean sync by default (pass `--keep-vms` to keep them, or `--delete-after` for pre-existing `--thunder` VMs). Verify no VMs remain afterward with `tnr --json status --no-wait </dev/null` (pass `stdin: "ignore"` / `</dev/null` to `tnr` to avoid interactive TUI hangs).
