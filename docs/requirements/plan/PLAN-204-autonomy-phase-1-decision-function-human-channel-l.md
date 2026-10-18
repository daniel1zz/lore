---
id: PLAN-204
type: plan
role: plan
title: "Autonomy phase 1: decision function, human channel, lore-executed cleanup, overrides escalate"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-197
phases:
  - {name: "Phase 1a: core"}
  - {name: "Phase 1b: human channel and verbs"}
  - {name: "Phase 1c: overrides, calibration, integrity"}
  - {name: "Phase 1d: apply on main"}
---
## Overview
Implements spec-autonomy-phase-1-decision-function-human-channel-lore (AC-AU-1..11) under adr-autonomy-is-decided-by-measured-facts-one-decision-function (accepted 2026-10-18).

| T | Task | AC |
|---|---|---|
| AU-T1 | decide() + operation-class registry + initial class table + B/E/J measurement in @lore/core | AC-AU-1 |
| AU-T2 | Decision log (append-only, hash-chained, worst-of per subject version, human-tty precedence) in the store + service | AC-AU-2 |
| AU-T3 | Human channel: lore decide (TTY, per-invocation nonce, agent-ancestry/env refusal), hook deny, no MCP/HTTP decide, lore pending lists decisions | AC-AU-3 |
| AU-T4 | lore stash prune: archive to refs/lore/archive/stash/<sha>, attribution, decide(stash-drop) | AC-AU-4 |
| AU-T5 | Run registration records pid + start time; lore run reap with ownership proof; stale runs with a dead pid ended (run-end-stale), legacy pid-less runs escalated as one decision | AC-AU-5 |
| AU-T6 | Agent hygiene: no stash steer, no self-matching waits, helper signal reaping, tracked files stay clean | AC-AU-6 |
| AU-T7 | Self-grantable overrides call decide() and escalate below threshold | AC-AU-7 |
| AU-T8 | Outcome calibration (pseudo-outcomes, reversal observers, governance-loosen) + sampling floor | AC-AU-8, AC-AU-10 |
| AU-T9 | Threshold record integrity: chain check, fail-safe escalate, mirrored as a git-tracked file, pre-push head check | AC-AU-9 |
| AU-T10 | Worktree removal (lore done, sweep, verify --falsify cleanup) through decide(worktree-remove) with the ignored-file rule | AC-AU-11 |
| AU-T11 | On main: run the new verbs on the existing debris (28 stashes, leaked lore-attested-red-* dirs, 28 unended runs) and lore verify AC-AU-1..11 | all |

Dependencies: AU-T1 blocks AU-T2; AU-T2 blocks AU-T3, AU-T4, AU-T5, AU-T7, AU-T8, AU-T9, AU-T10; AU-T3 blocks AU-T7, AU-T8, AU-T9 (they need the human path); AU-T8 and AU-T9 block AU-T7 (its control half raises a prior through lore autonomy set and the governed record); every other task blocks AU-T11.

Threshold source before AU-T9: AU-T1's registry carries the spec's class table as code defaults, and decide() reads them; AU-T9 moves them into the governed corpus record, seeded once from the code table as a recorded initial governance write, after which the code table is only the seed. AU-T6 is independent and starts at once. One phase per wave: "Phase 1a: core" (T1, T2, T6), "Phase 1b: human channel and verbs" (T3, T4, T5, T10), "Phase 1c: overrides, calibration, integrity" (T7, T8, T9), "Phase 1d: apply on main" (T11).

## Invariants
- INV-1: the git-safety hook's refusal of agent-typed destructive commands is unchanged (ADR D4); every destructive act is performed by a lore verb after decide() returns auto.
- INV-2: no factor is supplied by the calling agent. The pure core decide() in @lore/core takes facts (AC-AU-1); the service layer (DecisionService) is the only caller from commands, gathers every fact itself through lore's own probes in the same call (or stored attested evidence), and no public service method, CLI flag, MCP tool or HTTP route accepts a caller-provided factor value — a test asserts this on the service and the adapters.
- INV-3: red-first per AC with exact exit codes; main stays green: AC-AU-1..11 are ledgered not-built until their oracle lands.
- INV-4: each shipped change (assets/, binary) verified from a fresh consumer install (`lore setup` into a mkdtemp HOME; installed hook/asset byte-identical to assets/).
- INV-5: one derivation: no second permission rule is added outside decide() for a migrated path.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Overrides start escalating (prior 0.5) and stall unattended work | M | Expected and measured: lore pending batches them; the user answers in one sitting; outcomes then calibrate |
| Reaping kills a live process | H | Ownership proof (ancestry, or PPID 1 + start-time window + no overlapping live run + pid-reuse check); never touches live ancestry; concurrent-reap test |
| Human channel forgeable by a same-user agent (pty) | M | Named limit (ADR D7); ancestry/env refusal + hook deny + nonce never in agent-readable output; every decision records its channel and ancestry snapshot for audit |
| Decision log write contention across sessions | M | Append-only rows with chain computed in one transaction; concurrent test (AC-AU-2 half 4) |

## Exit Criteria
AC-AU-1..11 attested pass on main via lore verify; after AU-T11: `git stash list` holds only stashes of live runs, and every dropped stash resolves under refs/lore/archive/stash/; `git worktree list` shows no lore-attested-red-* entry, and a verify --falsify run that fails mid-way leaves none (AC-AU-11 half 3); the historical unregistered lore-attested-red-* directories in TMPDIR (machine-local temp files outside any repository) are counted in AU-T11's report and not removed in phase 1; no run without ended_at has a dead recorded pid, and the legacy pid-less unended runs are either ended through a human-tty decision or listed in one pending decision; bun run test exits 0.
