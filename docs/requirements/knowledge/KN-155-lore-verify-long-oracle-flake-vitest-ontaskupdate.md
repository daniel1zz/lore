---
id: KN-155
type: knowledge
role: knowledge
title: "lore verify long-oracle flake — vitest onTaskUpdate RPC timeout under load"
status: approved
priority: medium
created: 2026-07-16
updated: 2026-07-17
tags: [verify, flake, vitest, spec-046]
parent: PRD-001
---
## Finding (2026-07-16, SPEC-046/047 closing; ROOT CAUSE REVISED 2026-07-17)

`lore verify` on long full-regression ACs (AC-046-E / AC-047-C, `bun run typecheck && bun run test`) failed attested with exit 1 at 110–184s on FIVE runs across two days, while the byte-identical command passed under direct/replica execution. One attested pass (237s) exists.

## Root cause (evidence-based, revised)

Initial theory (load-sensitive vitest scheduling flake) was PARTIALLY WRONG — a quiet-machine run also failed. The decisive evidence came from a later fail's output_tail:

`Error: ENOSPC: no space left on device, mkdir '/var/folders/.../T/.../web'` (vitest transform/coverage temp write).

Machine state at diagnosis: APFS container with only ~17GB available on a 460GB disk. Near-full APFS + full-suite burst IO (vitest worker temp + transform cache + fixture DBs) → transient ENOSPC before purgeable-space reclaim kicks in; the `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled errors seen on the other failed runs are consistent with IO-stall-induced worker→orchestrator RPC timeouts on the same pressured volume. Whether a run fails depends on transient container free space, NOT on which runner spawned it.

Ruled out: env allowlist差异 (verbatim replica passed), pipe backpressure (verify-executor.ts:146-148 drains concurrently), stale dist/lore, lore-verify spawn semantics.

## Secondary finding

Test teardown leak: `lore-global-cfg-test-*` mkdtemp dirs accumulate in TMPDIR (small footprint, not the primary cause, but real — matches the SessionStart 'missing test teardown' health alert). Worth a cleanup task.

## Operational guidance

- Attested full-suite fail whose output_tail shows ENOSPC or vitest onTaskUpdate RPC timeout → CHECK DISK FREE SPACE first (`df -h /`); free the container, then re-run. Do not chase lore-verify internals — the executor is sound.
- Owner action item: this machine's APFS container is ~17GB free / 460GB — needs cleanup for reliable full-suite runs.
- Failed attested entries stay in evidence (append-only) — expected.
- Fix the `lore-global-cfg-test-*` teardown leak when convenient.


## Second independent cause (2026-07-17): 300s default verify timeout

A later attested fail showed a NEW signature: `exit 143 [TIMED OUT]` at 305s — the SPEC-039 `verify.default_timeout_ms` default (300_000ms) SIGTERM'd the run. The full-regression chain legitimately takes ~240–340s on this machine (typecheck ~40s + vitest ~35s + bun test ~200s+), so it rides the 300s edge: the one historical pass (237s) fit under it; slower runs get killed. Fix applied: `.lore/config.yaml` now sets `verify.default_timeout_ms: 900000`. This is configuration fitting measured reality, not symptom-masking — the suite's duration is legitimate.

Signature table for future triage:
- exit 1, tail has ENOSPC or vitest onTaskUpdate RPC timeout → disk pressure (check `df -h /`)
- exit 143, `[TIMED OUT]` → verify timeout undersized for the AC (config `verify.default_timeout_ms` / per-AC `verify.script.timeout_ms`)


## FINAL root-cause stack (2026-07-17, case closed)

The PRIMARY cause was found by a parallel session (CLAUDE.md eval-log row 2026-07-17): the session-start health-check hook ran the FULL vitest suite on every session start with a 30s spawnSync timeout that only killed the direct child — ORPHANING vitest fork workers (observed: 11 orphaned `node (vitest N)` processes at full CPU for ~1h, PPID=1); plus vitest's worker cap was dead config (`poolOptions.threads.*` while the active pool was 'forks'), so every run forked one worker per core. Every 'flaky' verify run was competing with those invisible CPU hogs — the worker-RPC timeouts, IO stalls, transient ENOSPC, and >300s durations were all downstream of that contention. After the hook/config fix (detached process-group SIGKILL, maxWorkers: 4, VITEST_MAX_WORKERS=2 for health checks) and orphan cleanup, AC-047-C attested passed first try (243s, exit 0).

Causal ranking: (1) orphaned vitest workers [fixed]; (2) 300s default verify timeout vs 240-340s legit duration [fixed: verify.default_timeout_ms 900000]; (3) tight disk (~17-24GB free) amplifying IO pressure [owner action item remains]. The 'background vs foreground shell' variable was a proxy for 'ran while orphans were alive'.

Triage table stands; add: before chasing runner internals, `ps aux | grep vitest` for orphan workers.
