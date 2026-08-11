---
id: KN-375
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
# Assessment: met (85/100)

Scope: plan `01KYKWM9EX33MZD4HCAEYWR9RQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TRACE-1 | 92 | Attested bun run shows 2 passing tests naming user_version 11, trace_events, and all four indexes; migration-011.ts in the diff creates the table + idx_trace_kind_ts/kind_actor/doc/ts and sets PRAGMA user_version = 11 verbatim. | 01KYKWNFZ9EE2HGCN5TPJ8D56X (T1 store; attested run [4] with output tail) |
| AC-TRACE-2 | 87 | Attested vitest run passes (5 passed/7 skipped under -t). Diff shows CorpusService.get/search firing recordGet/recordSearch only on ok results with post-filter hit count, and optional-DI so bare constructions are untraced. Per-field assertions (surface/doc_id) not visible. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 service; attested run [5]) |
| AC-TRACE-3 | 88 | Attested vitest run passes (7 passed); output tail shows the swallow-and-continue path firing ('simulated synchronous port failure') without failing the operation. GateEnforcer.enforce emits gate_deny with checkpoint/predicates_failed/layer=service after the verdict is computed. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 service; attested run [6]) |
| AC-TRACE-4 | 84 | Attested integration run passes 2 tests covering read/unread doc, hit/zero-hit search, and --raw-queries gating. TraceStatsService composes all four aggregates. deny-by-checkpoint content is asserted only indirectly; deny_retry_gap is an unvalidated best-effort heuristic. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 cli; attested run [7]) |
| AC-TRACE-5 | 84 | Attested run passes both the 'deletes only older rows / idempotent' and 'trace.enabled=false disables recording AND pruning' cases. Prune is bounded per batch and loops to exhaustion; the fire-and-forget trigger is never awaited before app.close(), so batch bounding under load is untested. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 cli; attested run [8]) |
| AC-TRACE-6 | 88 | Attested run passes the no-recursion regression test; TraceStatsService is store-SELECT-only by construction and never routes through CorpusService.get/search, so identical row counts hold structurally, not just empirically. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 cli; attested run [9]) |
| AC-TRACE-7 | 70 | Attested run passes, but the test names itself a proxy: a 'Turso-replica-shaped file' with a separate bun:sqlite handle that 'mirrors app.ts's wiring' — no real sync-mode TursoStore exercised. The REPLICATED_TABLES absence half is directly verified. | 01KYKWNFZ9EE2HGCN5TPJ8D56X (T1 store; attested run [10], output tail states the mirror) |

## Gaps

- feed.ts records the special-checkpoint feed trace only when `process.exitCode === 0`. Node leaves process.exitCode undefined until something sets it, so a handler that succeeds without explicitly assigning 0 produces no kind='feed' row. No AC evidence asserts a feed row exists, so this failure mode would pass every oracle.
- The AC-TRACE-7 happy-path test is self-described as a mirror: it opens a separate bun:sqlite handle on a 'Turso-replica-shaped file' and re-checks the schema/methods, rather than constructing the TursoStore branch of createApp. The actual localTraceStore wiring (and its close()) is unverified.
- deny_retry_gap runs auditEntries.some() inside a per-deny loop and the CLI's --since defaults to the Unix epoch, so cost grows with denies x full audit history on every `lore trace stats` invocation.
- loader.ts fires the prune without awaiting while commands close the App in a finally block; a prune batch still in flight at close time hits a closed handle. Swallowed, but it means the prune's completion is not actually guaranteed on any given invocation.
- T2 and T3 carry zero attested evidence of their own (0/2 and 3 self-reported); attestation for those ACs comes solely from the main-orchestrator's re-runs. Independent-tester authorship claimed in the plan is not visible in any evidence record.

## Recommendations

- Replace the process.exitCode success check in feed.ts with an explicit success signal from each checkpoint handler, and extend trace-stats.bun.test.ts to assert a kind='feed' row appears after a successful `lore feed`.
- Tighten AC-TRACE-7's verify command to exercise createApp's Turso branch (localTraceStore handle receives the write, store/client does not) instead of a replica-shaped-file simulation.
- Require at least one attested oracle run per task, not only per AC, so task-level records are not entirely self-reported.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 71749ms
- Retried: false
- Truncated sections: diff:packages/lore/src/store/schema-version.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/trace-stats.bun.test.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/trace-recorder.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.75 | evidence | All 7 ACs pass with attested runs; diff shows coherent store/service/CLI layering. Deductions: feed exitCode gating risk, proxy-only sync verification, heuristic deny-retry gap. |
| evidence_integrity | 85 | 0.8 | evidence | Every AC has an independent orchestrator re-run with an output tail naming the passing test titles; 0 failures. Ratio 0.50 attested, and T2/T3's own records are self-reported only. |
| scope_fidelity | 91 | 0.8 | evidence | Diff matches P1/P2/P3 exactly: migration-011, core schema, recorder port, instrumentation, config keys, trace verb, prune. Collateral edits are schema-version-bump test churn. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TRACE-4 | feed.ts records the special-checkpoint feed trace only when `process.exitCode === 0`. Node leaves process.exitCode undefined until something sets it, so a handler that succeeds without explicitly assigning 0 produces no kind='feed' row. No AC evidence asserts a feed row exists, so this failure mode would pass every oracle. |
| outcome | major | AC-TRACE-7 | The AC-TRACE-7 happy-path test is self-described as a mirror: it opens a separate bun:sqlite handle on a 'Turso-replica-shaped file' and re-checks the schema/methods, rather than constructing the TursoStore branch of createApp. The actual localTraceStore wiring (and its close()) is unverified. |
| outcome | minor | AC-TRACE-4 | deny_retry_gap runs auditEntries.some() inside a per-deny loop and the CLI's --since defaults to the Unix epoch, so cost grows with denies x full audit history on every `lore trace stats` invocation. |
| outcome | minor | AC-TRACE-5 | loader.ts fires the prune without awaiting while commands close the App in a finally block; a prune batch still in flight at close time hits a closed handle. Swallowed, but it means the prune's completion is not actually guaranteed on any given invocation. |
| evidence_integrity | minor | — | T2 and T3 carry zero attested evidence of their own (0/2 and 3 self-reported); attestation for those ACs comes solely from the main-orchestrator's re-runs. Independent-tester authorship claimed in the plan is not visible in any evidence record. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Replace the process.exitCode success check in feed.ts with an explicit success signal from each checkpoint handler, and extend trace-stats.bun.test.ts to assert a kind='feed' row appears after a successful `lore feed`. | The current gate can silently drop feed traces and no oracle would notice. |
| spec | Tighten AC-TRACE-7's verify command to exercise createApp's Turso branch (localTraceStore handle receives the write, store/client does not) instead of a replica-shaped-file simulation. | The AC states 'in sync mode'; the current oracle proves schema portability, not the wiring. |
| process | Require at least one attested oracle run per task, not only per AC, so task-level records are not entirely self-reported. | T2/T3 attested_count is 0; attestation currently concentrates in one orchestrator pass. |

## Unverifiable Materials

- packages/lore/src/store/sqlite-store.ts, turso-store.ts, store-interface.ts, store-shared.ts, schema-version.ts: Omitted from the diff by the truncation manifest; the actual SQL of the trace query/prune methods and LATEST_SCHEMA_VERSION=11 could not be inspected.
- packages/lore/tests/unit/store/trace-events.bun.test.ts, tests/unit/service/trace-recorder.test.ts, tests/integration/cli/trace-stats.bun.test.ts: Test bodies omitted; assertion strength judged only from titles and output tails in the attested runs.
- SPEC-102 source text: Only the structured AC table was provided; design decisions D1-D7 are known solely through code comments, so spec-conformance claims in those comments are unverified.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.50
