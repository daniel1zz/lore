---
id: KN-379
type: knowledge
role: knowledge
title: "Assessment: Implementation — trace layer (SPEC-102) (2026-07-28)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-10-23
tags: []
parent: PLAN-108
links:
  - {id: PLAN-108, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYKWM9EX33MZD4HCAEYWR9RQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TRACE-1 | 90 | Attested bun run (main-orchestrator) shows 2 pass/0 fail with test names naming user_version 11, trace_events, and all four indexes; column-shape test also present. Directly matches the AC statement. | 01KYKWNFZ9EE2HGCN5TPJ8D56X (T1 self-reported run), 01KYKWNGR47MWF2NBY7RSZVYHM (attested run [4] with output tail) |
| AC-TRACE-2 | 82 | Attested vitest run: 5 pass/0 fail, 7 skipped; tail shows recorder-seam Zod rejection path exercised. Test names not shown, so per-field coverage (actor/surface/doc_id/hit_count) and the bare-construction case are asserted by task text, not visible output. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 self-reported run), 01KYKWNGR47MWF2NBY7RSZVYHM (attested run [5]) |
| AC-TRACE-3 | 82 | Attested vitest run: 7 pass/0 fail; tail shows swallow-and-continue on a throwing recorder for gate_deny and get. Test names absent from output, so checkpoint/predicates_failed/layer field assertions are unverified from evidence alone. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 self-reported run), 01KYKWNGR47MWF2NBY7RSZVYHM (attested run [6]) |
| AC-TRACE-4 | 85 | Attested integration run: 2 pass/0 fail, ~800ms real CLI spawn; test names cover counts-by-kind, deny-by-checkpoint, zero-hit and never-read plus --raw-queries gating. --since windowing is not named in the visible test titles. | 01KYKWNGR47MWF2NBY7RSZVYHM (attested run [7]) |
| AC-TRACE-5 | 76 | Attested run: 2 pass/0 fail covering age-based deletion + idempotence and trace.enabled=false disabling both recording and pruning. The 'bounded batches' (LIMIT-loop) half of the AC is not evidenced by any visible assertion or test title. | 01KYKWNGR47MWF2NBY7RSZVYHM (attested run [8]) |
| AC-TRACE-6 | 80 | Attested run passes the no-recursion regression (stats reads emit zero trace rows), 6 expect() calls. Only 1 test ran here vs 2 for sibling ACs, so coverage is thinner than the other integration criteria. | 01KYKWNGR47MWF2NBY7RSZVYHM (attested run [9]) |
| AC-TRACE-7 | 68 | Attested run passes, but its own test title says the handle test 'mirrors app.ts's ApiKeyStore-precedent wiring' on a 'Turso-replica-shaped file' — it simulates sync-mode wiring rather than exercising TursoStore. Only the REPLICATED_TABLES exclusion is directly asserted. | 01KYKWNGR47MWF2NBY7RSZVYHM (attested run [10] output tail) |

## Gaps

- The passing test's own name states it uses a SEPARATE bun:sqlite handle on a 'Turso-replica-shaped file' that 'mirrors app.ts's ApiKeyStore-precedent wiring'. That is a reconstruction of the wiring under test, not the wiring itself, so the AC's 'in sync mode trace writes land via the separate local handle' claim is only indirectly evidenced. Only the REPLICATED_TABLES exclusion is a direct assertion.
- AC-TRACE-5 requires deletion 'in bounded batches'. The attested output shows two tests: age-filtering/idempotence and the trace.enabled=false negative. Nothing visible exercises the LIMIT 50000 batching loop, so an unbounded single DELETE would still pass this oracle.
- No diff was provided (diff_available: false, tests_touched: false). Implementation quality — migration SQL correctness, three-store parity, recorder swallow semantics, stats non-recursion mechanism — is inferable only from test titles authored by the same effort. Per conservative scoring, these remain unverified.
- All three tasks remain status=draft while carrying full AC evidence; T1 and T2 have 0 attested records of their own (attestation exists only as main-orchestrator duplicates on T3). The evidence trail's provenance is sound but its bookkeeping state is inconsistent.
- The --since window is part of the AC statement but does not appear in either visible test title; both passing tests describe aggregate content and --raw-queries gating instead.

## Recommendations

- Require a diff in the audit bundle whenever a plan introduces a schema migration or a new DI port; score outcome as absence-based until one is present.
- Replace the mirrored-wiring test for AC-TRACE-7 with one that constructs the real Turso composition root and asserts trace rows land on the replica-local handle and never enter the sync-push set.
- Split AC-TRACE-5 into two criteria — age-correct deletion, and bounded-batch execution — so the batching bound gets its own oracle.
- Block verify exit while tasks covering all ACs are still status=draft, or auto-promote on attestation.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 69079ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All 7 ACs have passing attested oracle runs with real output. Deductions: AC-TRACE-7 tests a mirror of the wiring, AC-TRACE-5's batch bound unasserted. |
| evidence_integrity | 74 | 0.7 | evidence | Every AC independently re-run by main-orchestrator with captured tails — strong. Weakened by 0.50 attested ratio, tasks still draft, and no diff to cross-check tests against code. |
| scope_fidelity | 70 | low | absence | Task descriptions map cleanly onto P1/P2/P3 and no extra ACs appear, but with no diff and no tests_touched signal, drift outside the described surfaces cannot be ruled out. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TRACE-7 | The passing test's own name states it uses a SEPARATE bun:sqlite handle on a 'Turso-replica-shaped file' that 'mirrors app.ts's ApiKeyStore-precedent wiring'. That is a reconstruction of the wiring under test, not the wiring itself, so the AC's 'in sync mode trace writes land via the separate local handle' claim is only indirectly evidenced. Only the REPLICATED_TABLES exclusion is a direct assertion. |
| outcome | minor | AC-TRACE-5 | AC-TRACE-5 requires deletion 'in bounded batches'. The attested output shows two tests: age-filtering/idempotence and the trace.enabled=false negative. Nothing visible exercises the LIMIT 50000 batching loop, so an unbounded single DELETE would still pass this oracle. |
| evidence_integrity | major | — | No diff was provided (diff_available: false, tests_touched: false). Implementation quality — migration SQL correctness, three-store parity, recorder swallow semantics, stats non-recursion mechanism — is inferable only from test titles authored by the same effort. Per conservative scoring, these remain unverified. |
| evidence_integrity | minor | — | All three tasks remain status=draft while carrying full AC evidence; T1 and T2 have 0 attested records of their own (attestation exists only as main-orchestrator duplicates on T3). The evidence trail's provenance is sound but its bookkeeping state is inconsistent. |
| outcome | minor | AC-TRACE-4 | The --since window is part of the AC statement but does not appear in either visible test title; both passing tests describe aggregate content and --raw-queries gating instead. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require a diff in the audit bundle whenever a plan introduces a schema migration or a new DI port; score outcome as absence-based until one is present. | Seven green oracles cannot distinguish a correct migration-011 from a test that asserts whatever was written. |
| plan | Replace the mirrored-wiring test for AC-TRACE-7 with one that constructs the real Turso composition root and asserts trace rows land on the replica-local handle and never enter the sync-push set. | The current test would stay green if app.ts wiring regressed, which is exactly the failure AC-TRACE-7 exists to catch. |
| spec | Split AC-TRACE-5 into two criteria — age-correct deletion, and bounded-batch execution — so the batching bound gets its own oracle. | Compound ACs let one clause pass unasserted; batching is the property that protects startup latency. |
| process | Block verify exit while tasks covering all ACs are still status=draft, or auto-promote on attestation. | Draft tasks with complete evidence make the plan state unreliable as a completion signal. |

## Unverifiable Materials

- Implementation diff (migration-011 SQL, StoreInterface trace methods across SQLiteStore/TursoStore/InMemoryStore, TraceRecorder port, app.ts composition wiring, trace stats verb): diff_available: false — no source was supplied, so correctness, store parity and scope containment are inferred from test titles only.
- Test source for trace-events.bun.test.ts, trace-recorder.test.ts and trace-stats.bun.test.ts: Only pass counts and truncated output tails were provided; assertion strength and the independent-tester authorship claim cannot be checked.
- lore verify exit-gate run and build-freshness precheck: The plan names lore verify as the exit gate, but no verify run appears in the evidence set.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.50
