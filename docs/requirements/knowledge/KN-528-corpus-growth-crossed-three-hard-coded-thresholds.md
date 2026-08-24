---
id: KN-528
type: knowledge
role: knowledge
title: "Corpus growth crossed three hard-coded thresholds in one test file, and every failure message lied about its cause (ENOBUFS as exit 1, a 2-second timeout margin)"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: [oracle, false-oracle, corpus-growth, enobufs, silent-fallback, diagnosis]
parent: SPEC-145
---
# Corpus growth crossed three hard-coded thresholds inside one test file, and every failure lied about its cause

Measured 2026-08-24 on `main` at `5c8f46c1`, `scripts/tests/spec-mirror-export.test.ts`,
3 failed / 20 passed, stable and reproducible with the file run ALONE (so not contention,
not starvation, not the diff).

This is the standing brief's own sentence coming true: *"Self-checking must stay cheaper than
corpus growth."* All three failures are the SAME root cause — a constant written when the
corpus was smaller — and not one of them names it.

## Failure 1: ENOBUFS wearing an exit code

```
Error: test setup: lore list --type knowledge --json --include-invalid failed (exit 1):
 ❯ readLiveCorpusDocsIncludingInvalid scripts/tests/spec-mirror-export.test.ts:183
```

`runLore` declares `maxBuffer: 20 * 1024 * 1024` (20,971,520). The command now emits
**22,263,596 bytes**. A/B probe, same command, only maxBuffer varied:

| maxBuffer | `status` | stdout bytes | `error.code` |
|---|---|---|---|
| 20 MB | `null` | 20,857,687 | **ENOBUFS** |
| 64 MB | `0` | 22,081,771 | none |

⛔ TWO silent conversions stack here:
1. `spawnSync` reports a buffer overflow as `status: null` + `error.code: "ENOBUFS"` — never a
   nonzero exit code.
2. `runLore` returns `result.status ?? 1` and DISCARDS `result.error` entirely. So an
   infrastructure failure is reported to the caller as "the command exited 1", with an empty
   stderr and no way to tell the difference.

The `?? 1` is the repo's own banned pattern — a silent fallback on a required field — sitting
in a test helper whose doc comment says *"Explicit `maxBuffer` per this repo's spawnSync-
truncation discipline"*. It OBEYED the anti-truncation rule and thereby created a new silent
failure mode. Obeying a discipline is not the same as being safe.

## The real root cause: the payload is 370x larger than the assertion needs

`readLiveCorpusDocsIncludingInvalid` returns `{ id, slug }[]`. Measured on the same output:

| | bytes | share |
|---|---|---|
| full `--json` payload | 20,727,213 | 100% |
| `content` fields | 3,694,822 | 17.8% |
| **what the test actually uses (`id`+`slug`)** | **56,106** | **0.27%** |

`lore list --json` returns the entire DocRecord — `content`, `extra`, timestamps, 18 keys —
and `extra` is the larger half (assessment AC tables, handoff payloads). Raising maxBuffer only
buys time: at 525 knowledge docs the payload is 20.7 MB and the corpus grows monotonically.

⛔ Raising the constant is a SYMPTOM fix. The root fix is that the oracle must stop asking for
data it does not read. Candidates, none implemented here: field projection on `lore list`
(`--fields id,slug`); paging through the existing `--limit/--offset` (already deterministic per
its own regression test) and accumulating; or a dedicated id/slug listing surface.

## Failures 2 and 3: the same clock, 2 seconds from the edge

`drift-check-is-separate` HAPPY and NEGATIVE both `Test timed out in 30000ms`. Their last
recorded GREEN runs, earlier the same session, took **28298 ms** and **27931 ms** — under the
30 s limit by 1.7 s and 2.1 s. Each runs `export-spec-mirror --check` TWICE over 1,646 mirror
files, and every `--check` shells out to `lore list` per type. Adding a handful of docs pushed
both past the wall.

⛔ A test whose green margin is 6% of its own timeout is not passing, it is pending. Neither
failure message mentions the corpus, the file count, or the margin — they say "timed out",
which reads as a hang.

## Why this belongs next to the mirror-parity finding

`knowledge-the-mirror-content-parity-oracle-is-structurally` recorded that the same file's
content-parity assertions can never be stably green because they require an exclusive corpus.
This is the second, INDEPENDENT way the same oracle decays: parity fails on concurrency, and
these three fail on VOLUME. Both were read as "the mirror is broken" at first. Neither is.

## Detection rule this session paid for twice

A failure's identity comes from its LINE and its MEASURED cause, never from its message or its
test title:
- `expected 2 to be +0` under a title ending `links_broken === 0` was a mirror exit code
  (line 294, not 301) — four probes chased a quantity that was always 0.
- `failed (exit 1)` with empty stderr was ENOBUFS, which produces no exit code at all.
- `Test timed out` was a 2-second margin against a growing corpus, not a hang.
