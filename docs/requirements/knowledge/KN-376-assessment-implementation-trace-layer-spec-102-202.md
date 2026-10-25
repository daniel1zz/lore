---
id: KN-376
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
# Assessment: met (82/100)

Scope: plan `01KYKWM9EX33MZD4HCAEYWR9RQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TRACE-1 | 90 | Attested bun run shows 2 passing named tests asserting user_version 11, trace_events, and all four indexes; migration-011 SQL in the diff matches (4 CREATE INDEX + PRAGMA user_version = 11). Store files applying it are unseen but oracle output is direct. | 01KYKWNFZ9EE2HGCN5TPJ8D56X (T1 + attested run [4] with output_tail) |
| AC-TRACE-2 | 80 | Attested vitest run passes (5 passed/7 skipped under -t filter), and diff shows CorpusService.get/search firing recordGet/recordSearch only on ok results with post-filter hit count. Test names not visible, so 'bare construction inserts nothing' and column-level assertions are unverified. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 + attested run [5]) |
| AC-TRACE-3 | 85 | Attested run passes; stderr tail shows the swallow path exercised with a simulated synchronous port failure, matching TraceRecorder's try/catch around insert. GateEnforcer fires layer='service' after the verdict is computed, so Result is unaffected by construction. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 + attested run [6]) |
| AC-TRACE-4 | 88 | Attested integration run passes two named tests covering read/unread docs, hit and zero-hit searches, and --raw-queries gating. TraceStatsService composes all four aggregates plus the --since window; SQLite implementations of those queries are unseen. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 + attested run [7]) |
| AC-TRACE-5 | 76 | Attested run passes cutoff-only deletion and trace.enabled=false disabling both recording and pruning. The 'bounded batches' half is not visible in any test name; prune is fired unawaited from loadLoreApp before app.close(), so batch-loop behavior in a real CLI process is unverified. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 + attested run [8]) |
| AC-TRACE-6 | 85 | Attested run passes a REGRESSION test asserting stats reads emit zero trace rows; TraceStatsService is SELECT-only by construction and the trace command never routes through CorpusService. Attested tail shows 1 pass, not 2. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 + attested run [9]) |
| AC-TRACE-7 | 66 | Attested run passes, but its own test name says it MIRRORS app.ts's wiring on a 'Turso-replica-shaped file' rather than exercising createApp's Turso branch; the replicated-set exclusion half is directly asserted. Sync-mode write path therefore evidenced only by analogy. | 01KYKWNFZ9EE2HGCN5TPJ8D56X (T1 + attested run [10]) |

## Gaps

- The AC-TRACE-7 happy-path oracle is named as mirroring app.ts's ApiKeyStore-precedent wiring on a Turso-replica-shaped file, not as driving createApp's sync branch. The claim 'in sync mode trace writes land via the separate local handle' is therefore evidenced by analogy; a regression in createApp's Turso wiring (e.g. binding the recorder to `store` instead of `localTraceStore`) would not be caught.
- Bounded-batch pruning is asserted only by the implementation shape (MAX_ITERATIONS loop over a LIMIT-ed DELETE). No named test seeds more rows than one batch, so a regression collapsing the loop to a single unbounded DELETE would still pass AC-TRACE-5.
- feed.ts records the trace only when `process.exitCode === 0`. Node initializes process.exitCode to undefined; unless every SPECIAL_CHECKPOINT_HANDLER explicitly assigns 0 on success, successful serves are silently untraced. Handler bodies are not in the diff, so this cannot be ruled out.
- The startup prune is fired without await from loadLoreApp while every command closes the store in a finally block. Multi-batch prunes will typically be truncated by process exit or hit a closed handle; failures are swallowed by design, so this degradation is invisible in production.
- The AC-TRACE-2/AC-TRACE-3 vitest tails report only counts (5 passed/7 skipped, 7 passed/5 skipped) with no test names, so the specific assertions (correct kind/actor/surface/doc_id/hit_count columns; bare construction inserts nothing) cannot be confirmed from the evidence shown.
- Attested ratio is 0.50: T1/T2/T3 task records carry recorder=agent:trace-layer (the implementer) with 0 attested entries at task level; independent confirmation exists only via the orchestrator-recorded duplicates.

## Recommendations

- Add a Turso-mode oracle that builds the App through createApp with sync enabled, writes a trace row, and asserts (a) the row is present in the local replica file via the separate handle and (b) trace_events is excluded from the push set — replacing the current mirror-style test as AC-TRACE-7's happy path.
- Extend the AC-TRACE-5 test to seed more expired rows than one prune batch and assert the loop issues multiple bounded deletes and terminates at zero.
- Specify the success signal for feed instrumentation explicitly (handler return value rather than process.exitCode) and state whether an unawaited startup prune is allowed to be truncated by process exit.
- Require task-level evidence to carry at least one attested recorder distinct from the implementing agent before a task is archived.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 84995ms
- Retried: false
- Truncated sections: diff:packages/lore/src/store/schema-version.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/trace-stats.bun.test.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/trace-recorder.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | All 7 ACs pass with attested runs and the diff shows coherent store/service/CLI layering; weaknesses are in the sync-mode path and a fragile feed success check. |
| evidence_integrity | 76 | 0.65 | evidence | Every AC has one attested run with output tails, but ratio is 0.50 and AC-TRACE-2/3 tails show no test names, so what those oracles assert is not visible. |
| scope_fidelity | 90 | 0.75 | evidence | Diff maps cleanly onto P1/P2/P3 task descriptions; config keys, wiring, verb, instrumentation and prune all present with no unexplained unrelated changes. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TRACE-7 | The AC-TRACE-7 happy-path oracle is named as mirroring app.ts's ApiKeyStore-precedent wiring on a Turso-replica-shaped file, not as driving createApp's sync branch. The claim 'in sync mode trace writes land via the separate local handle' is therefore evidenced by analogy; a regression in createApp's Turso wiring (e.g. binding the recorder to `store` instead of `localTraceStore`) would not be caught. |
| outcome | minor | AC-TRACE-5 | Bounded-batch pruning is asserted only by the implementation shape (MAX_ITERATIONS loop over a LIMIT-ed DELETE). No named test seeds more rows than one batch, so a regression collapsing the loop to a single unbounded DELETE would still pass AC-TRACE-5. |
| outcome | minor | — | feed.ts records the trace only when `process.exitCode === 0`. Node initializes process.exitCode to undefined; unless every SPECIAL_CHECKPOINT_HANDLER explicitly assigns 0 on success, successful serves are silently untraced. Handler bodies are not in the diff, so this cannot be ruled out. |
| outcome | minor | — | The startup prune is fired without await from loadLoreApp while every command closes the store in a finally block. Multi-batch prunes will typically be truncated by process exit or hit a closed handle; failures are swallowed by design, so this degradation is invisible in production. |
| evidence_integrity | minor | AC-TRACE-2 | The AC-TRACE-2/AC-TRACE-3 vitest tails report only counts (5 passed/7 skipped, 7 passed/5 skipped) with no test names, so the specific assertions (correct kind/actor/surface/doc_id/hit_count columns; bare construction inserts nothing) cannot be confirmed from the evidence shown. |
| evidence_integrity | minor | — | Attested ratio is 0.50: T1/T2/T3 task records carry recorder=agent:trace-layer (the implementer) with 0 attested entries at task level; independent confirmation exists only via the orchestrator-recorded duplicates. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a Turso-mode oracle that builds the App through createApp with sync enabled, writes a trace row, and asserts (a) the row is present in the local replica file via the separate handle and (b) trace_events is excluded from the push set — replacing the current mirror-style test as AC-TRACE-7's happy path. | Current oracle re-creates the wiring shape rather than exercising it, so composition-root regressions are undetected. |
| plan | Extend the AC-TRACE-5 test to seed more expired rows than one prune batch and assert the loop issues multiple bounded deletes and terminates at zero. | The 'bounded batches' clause of the AC is currently unasserted. |
| spec | Specify the success signal for feed instrumentation explicitly (handler return value rather than process.exitCode) and state whether an unawaited startup prune is allowed to be truncated by process exit. | Both are correctness-relevant behaviors the spec leaves to implementer judgment. |
| process | Require task-level evidence to carry at least one attested recorder distinct from the implementing agent before a task is archived. | All three tasks archived with implementer-only task-level records; attestation ratio is 0.50. |

## Unverifiable Materials

- packages/lore/src/store/sqlite-store.ts, turso-store.ts, store-interface.ts, store-shared.ts, schema-version.ts: Omitted per truncation manifest; the actual SQL for the trace aggregate/prune queries and the StoreInterface contract could not be inspected.
- packages/lore/tests/unit/service/trace-recorder.test.ts and tests/integration/cli/trace-stats.bun.test.ts bodies: Test sources omitted; assertions behind AC-TRACE-2..6 are known only from names/counts in the output tails.
- SPEC-102 full text: Only the AC table was provided; claims in code comments citing D1-D7 and §Schema could not be checked against the spec.
- feed.ts SPECIAL_CHECKPOINT_HANDLERS bodies: Not in the diff, so whether each handler assigns process.exitCode = 0 on success (a precondition for feed tracing to fire) is unknown.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.50
