---
id: KN-069
type: knowledge
role: knowledge
title: "Retro — SPEC-077 F3 full chain: parallel-wave shape drift, vacuous e2e, concurrent-session coexistence (2026-07-25)"
status: approved
priority: medium
created: 2026-07-25
updated: 2026-07-26
tags: []
parent: PLAN-041
links:
  - {id: PLAN-041, type: relates-to}
---
# Retro — SPEC-077 F3 execution read surface: full chain in one session (2026-07-25)

Design round (module mode) → SPEC-077 (6 script ACs) → plan (3 tasks, blocks-linked) → parallel implementation → e2e-caught drift fix → 6/6 attested verify → plan archived. Two adhoc byproduct fixes landed en route.

## What landed
- `/execution` page (T2), `GET /api/phase-status` + ready `claim_ttl_minutes` (T1), execution e2e + seed fixture (T3), all merged; full Playwright 40/40, vitest/bun green in SPEC-077 scope.
- Byproduct 1: live SPEC-042-era regression — `apiGetReady` typed flat `ReadyRecord[]` vs server `ReadyReport` object; home-page consumers were one resolved query away from a render TypeError. Red-first proven (`records.filter is not a function`), consumers migrated to `apiGetReadyReport`, stale client deleted. e2e had passed VACUOUSLY: no fixture ever asserted `PlanReadinessSummary` text, so the buggy path never executed under test.
- Byproduct 2: T1/T2 parallel-wave shape drift — T2 authored client `PhaseScorecard` types from the spec's PROSE pin before T1's real projection existed (`phase_title` vs `name`, `checklist_items[].trust`, no `dropped_item_names` wire field). `PhaseProgressPanel` threw on first real render; no error boundary → whole `/execution` page blanked. The T3 e2e (real server, real seed) caught it; fix byte-mirrors the service types; spec S3 pin corrected to as-built.

## Process lessons
1. **A spec prose pin does not synchronize parallel implementers.** Two agents both "conformed" to the same English sentence and still diverged on field names. The synchronizer is a CONTRACT ORACLE that runs against the real route (the T3 e2e did this job late; a cheap shape-assertion test in T2's own scope, hitting the real handler, would have done it early). Consider: when a wave splits producer/consumer of a new route, give the consumer task an explicit "curl the real route before freezing types" step, or serialize types through a shared core interface (server exports, client imports — impossible here only because the dashboard cannot import server code; a generated fixture would work).
2. **e2e green ≠ path covered.** Two vacuous passes surfaced in one week (browse-ux never resolving a readiness row; SPEC-075's zero-match -t). The execution e2e was designed against a seed that FORCES every panel populated — that is why it caught the drift. Seeds should be adversarial: force every consumer path to actually execute.
3. **Concurrent-session coexistence worked.** A second orchestrator drove SPEC-076 on the same machine/main concurrently (red-first commits interleaved with ours). Deterministic separation held: distinct actors, distinct anchors, no claim/anchor collisions. Two costs observed: (a) full-suite runs picked up the OTHER session's deliberate RED tests (merge-settings-prune ×4 vitest, setup-backup-prune ×2 bun) — an acceptance gate must attribute failures before blocking on them; (b) simultaneous full bun-test runs produced contention phantoms (11 "fails"/985 tests in one run vs 2 deterministic REDs on re-run — spawn starvation, the 2026-07-23 lesson again). `lore assess --diff` was skipped for the same reason: interleaved foreign commits make any contiguous range lie about scope drift.
4. **verify needs a claim context**: `lore verify <plan>` with no fresh claim refuses without `--task`; a `--task <t>` run executes ALL plan ACs but attests toward that task — running it once per evidence-bearing task is what satisfied the plan-close attestation floor (assess flagged T2 at 5/5 self-reported before the second run).
5. Assess advisories worth keeping: capture evidence output_tail from the END of runs (assertion summary, not server boot noise); attach a grep oracle to doc-sync deliverables; split multi-clause ACs or name per-clause test titles.
