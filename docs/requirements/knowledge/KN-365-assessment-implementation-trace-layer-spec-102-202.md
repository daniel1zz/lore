---
id: KN-365
type: knowledge
role: knowledge
title: "Assessment: Implementation — trace layer (SPEC-102) (2026-07-28)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
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
| AC-TRACE-1 | 92 | Attested bun test run passes 2 named tests (user_version 11, trace_events + all four indexes, columns verbatim). migration-011.ts in diff matches: 4 CREATE INDEX IF NOT EXISTS, PRAGMA user_version=11, LATEST_SCHEMA_VERSION bumped to 11, chain branch added in sqlite-store and turso-store. | 01KYM95PEQ5F3JG9TE0YPE88MR (T4 evidence[1] attested, plus full-file run evidence[9]) |
| AC-TRACE-2 | 88 | Attested vitest run: 5 pass under -t AC-TRACE-2. Diff shows optional traceRecorder DI on CorpusService with get (post-success only) and search (visibleHits.length) call sites; bare constructions leave it undefined. Test file itself truncated, so kind/actor/surface/doc_id assertions unseen. | 01KYM95PEQ5F3JG9TE0YPE88MR (T4 evidence[2]; T3 evidence[5] independently attested) |
| AC-TRACE-3 | 88 | Attested vitest run: 7 pass; stderr tail shows both the throwing-port and Zod-failure degradation paths exercised. GateEnforcer fires recordGateDeny with checkpoint/predicates_failed/layer=service after the blocked verdict; TraceRecorder swallows sync throw, rejection and err Result. | 01KYM95PEQ5F3JG9TE0YPE88MR (T4 evidence[3]) |
| AC-TRACE-4 | 85 | Attested integration run: 2 tests pass covering counts-by-kind/deny-by-checkpoint/zero-hit/never-read plus --raw-queries gating. trace.ts command is a thin renderer over TraceStatsService, which is truncated — the aggregation logic itself (incl. deny_retry_gap) is unseen. | 01KYM95PEQ5F3JG9TE0YPE88MR (T4 evidence[4]; T3 evidence[7] attested) |
| AC-TRACE-5 | 85 | Attested run: STATE test (deletes only rows older than retention_days, idempotent) and NEGATIVE test (trace.enabled=false disables recording AND pruning) both pass. trace-retention.ts bounded loop + config resolvers visible; app.ts wiring truncated. | 01KYM95PEQ5F3JG9TE0YPE88MR (T4 evidence[5]) |
| AC-TRACE-6 | 82 | Attested run: 1 regression test passes (stats reads emit zero trace rows). Single-test coverage for the AC, but the design reason is visible in the diff — trace.ts issues only SELECTs and never routes through CorpusService.get/search. | 01KYM95PEQ5F3JG9TE0YPE88MR (T4 evidence[6]) |
| AC-TRACE-7 | 55 | Half met. The REGRESSION half (trace_events absent from REPLICATED_TABLES) is real. The HAPPY half is self-described as a MIRROR on a replica-shaped file, not the real createApp Turso branch. T4 scoped exactly this fix, yet the T4 run shows identical test names and identical 2 pass/8 filtered count… | 01KYM95PEQ5F3JG9TE0YPE88MR (T4 evidence[7] test names/counts identical to T3 evidence[10]) |

## Gaps

- The AC states trace writes land via the separate local handle in sync mode. The oracle's happy-path test asserts only that a separate bun:sqlite handle on a Turso-replica-SHAPED file supports the schema — it never constructs the real createApp Turso branch. T4 explicitly scoped this remediation, but its AC-TRACE-7 run reports the same two test names and the same 2 pass / 8 filtered counts as T3, so no new test was added. The AC's happy half is therefore evidenced by a mirror, not by the wiring …
- T4 item 4 called for awaiting the in-flight prune on the App close path. loader.ts in the diff still fires app.pruneTraceEventsOpportunistically?.() unawaited with no promise handle, while commands close the App in a finally block. The tracking could live in the truncated app.ts, but nothing in the visible materials or evidence confirms it.
- T4's evidence does not distinguish itself from T3's for the finding it was created to fix. For AC-TRACE-7 the output tails are byte-comparable in test names and counts. An oracle re-run that cannot fail differently after a fix is not evidence the fix landed; the task nevertheless moved to archived.
- T1 (store) and T2 (service) carry attested_count 0 — two self-reported test runs each, no attested oracle at claim time. Their ACs are re-covered by attested T3/T4 runs, which mitigates but does not retroactively verify the tasks as claimed.
- InMemoryStore.insertTraceEvent derives id from traceEvents.length + 1 while pruneTraceEvents splices rows out of the array. After any prune, subsequent inserts reuse ids that already existed, diverging from the AUTOINCREMENT semantics the real stores provide. No trace query currently reads id, so this is latent rather than live.

## Recommendations

- Require that a hardening task's evidence differ observably from the evidence of the run it remediates (new test name, changed pass count, or a targeted -t filter naming the new case). Re-running an unchanged oracle should not satisfy a fix-a-finding task.
- Reopen the AC-TRACE-7 remediation: build the real Turso composition (sync.enabled + file: remote_url + LORE_SYNC_TOKEN through createApp), assert trace rows land on the local handle, and keep the REPLICATED_TABLES absence assertion as the second half.
- Add a close-path await for the opportunistic prune promise (track it on App, await in close), and cover it with a test that closes the App while a batch is in flight.
- Pin a default --since watermark for lore trace stats rather than leaving the implementation to choose the Unix epoch.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 90142ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/tests/unit/service/trace-recorder.test.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/trace-stats-service.ts, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/trace-stats.bun.test.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/trace-stats-service.ts, diff:packages/lore/tests/integration/cli/trace-stats.bun.test.ts, diff:packages/lore/tests/unit/service/trace-stats-service.test.ts
- Reasoning clipped for: AC-TRACE-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.75 | evidence | 6 of 7 ACs fully evidenced with attested runs and matching diff. AC-TRACE-7's happy path is a mirror, not real Turso composition, and the T4 fix for it is not reflected in its evidence. |
| evidence_integrity | 72 | 0.8 | evidence | Attested per-AC + full-file runs and a typecheck pass. But T1/T2 are self-reported only (ratio 0.54), and T4's evidence is identical to T3's for AC-TRACE-7 — it does not demonstrate the claimed fix. |
| scope_fidelity | 88 | 0.8 | evidence | Diff stays within P1/P2/P3 boundaries: migration-011, store methods, core schema/config, recorder port, CLI verb, instrumentation, prune. No unexplained files; epoch --since default is documented in-… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TRACE-7 | The AC states trace writes land via the separate local handle in sync mode. The oracle's happy-path test asserts only that a separate bun:sqlite handle on a Turso-replica-SHAPED file supports the schema — it never constructs the real createApp Turso branch. T4 explicitly scoped this remediation, but its AC-TRACE-7 run reports the same two test names and the same 2 pass / 8 filtered counts as T3, so no new test was added. The AC's happy half is therefore evidenced by a mirror, not by the wiring … |
| outcome | minor | AC-TRACE-5 | T4 item 4 called for awaiting the in-flight prune on the App close path. loader.ts in the diff still fires app.pruneTraceEventsOpportunistically?.() unawaited with no promise handle, while commands close the App in a finally block. The tracking could live in the truncated app.ts, but nothing in the visible materials or evidence confirms it. |
| evidence_integrity | major | — | T4's evidence does not distinguish itself from T3's for the finding it was created to fix. For AC-TRACE-7 the output tails are byte-comparable in test names and counts. An oracle re-run that cannot fail differently after a fix is not evidence the fix landed; the task nevertheless moved to archived. |
| evidence_integrity | minor | — | T1 (store) and T2 (service) carry attested_count 0 — two self-reported test runs each, no attested oracle at claim time. Their ACs are re-covered by attested T3/T4 runs, which mitigates but does not retroactively verify the tasks as claimed. |
| outcome | minor | — | InMemoryStore.insertTraceEvent derives id from traceEvents.length + 1 while pruneTraceEvents splices rows out of the array. After any prune, subsequent inserts reuse ids that already existed, diverging from the AUTOINCREMENT semantics the real stores provide. No trace query currently reads id, so this is latent rather than live. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that a hardening task's evidence differ observably from the evidence of the run it remediates (new test name, changed pass count, or a targeted -t filter naming the new case). Re-running an unchanged oracle should not satisfy a fix-a-finding task. | T4's AC-TRACE-7 evidence is indistinguishable from T3's, so the archived status asserts a fix the evidence cannot support. |
| plan | Reopen the AC-TRACE-7 remediation: build the real Turso composition (sync.enabled + file: remote_url + LORE_SYNC_TOKEN through createApp), assert trace rows land on the local handle, and keep the REPLICATED_TABLES absence assertion as the second half. | The AC's happy path is currently evidenced by a mirror the T4 assessment itself flagged as insufficient. |
| plan | Add a close-path await for the opportunistic prune promise (track it on App, await in close), and cover it with a test that closes the App while a batch is in flight. | Fire-and-forget prune plus a finally-block close is an unresolved use-after-close window. |
| spec | Pin a default --since watermark for lore trace stats rather than leaving the implementation to choose the Unix epoch. | The epoch default makes the deny_retry_gap join scan all history by default; the implementation notes the spec is silent here. |

## Unverifiable Materials

- packages/lore/src/app.ts: Truncated. The composition root wiring for TraceRecorder, the Turso separate-local-handle branch, traceStatsService, and any prune-promise tracking on the close path are all unseen.
- packages/lore/src/service/trace-stats-service.ts: Truncated. All AC-TRACE-4 aggregation logic, including the deny_retry_gap complexity fix claimed in T4 item 3, is unseen.
- packages/lore/tests/integration/cli/trace-stats.bun.test.ts: Truncated. The +2 test count between T3 and T4 suggests the feed-row oracle from T4 item 2 was added, but no evidence line names or runs it.
- packages/lore/tests/unit/store/trace-events.bun.test.ts: Truncated. Test counts are unchanged between T3 and T4 (10 total), so the AC-TRACE-7 real-wiring test appears absent, but the assertions inside the existing tests cannot be inspected.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 3 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.54
