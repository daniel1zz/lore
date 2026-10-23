---
id: KN-357
type: knowledge
role: knowledge
title: "Assessment: Implementation — trace layer (SPEC-102) (2026-07-29)"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-10-23
tags: []
parent: PLAN-108
links:
  - {id: PLAN-108, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01KYKWM9EX33MZD4HCAEYWR9RQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TRACE-1 | 92 | 6 passes (4 attested, 0 fail) with output_tail naming user_version 11 + all four indexes and column-shape parity. Diff shows migration-011 SQL, LATEST_SCHEMA_VERSION=11, and the <11 branch in both SQLiteStore and TursoStore — code and oracle agree. | 01KYKWNFZ9EE2HGCN5TPJ8D56X (T1 store: migration-011 + schema oracle), 01KYM95PEQ5F3JG9TE0YPE88MR (T4 re-run, attested) |
| AC-TRACE-2 | 87 | 6 passes (4 attested). Diff shows optional traceRecorder DI on CorpusService with get/search fire sites (post-filter visibleHits.length) and Zod seam. Weakness: 7 of 12 tests filtered under -t, and per-field assertions (kind/actor/surface/doc_id) are not visible in output_tail. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 service instrumentation) |
| AC-TRACE-3 | 87 | 5 passes (4 attested). Diff shows GateEnforcer deny fires recordGateDeny(layer="service") after the verdict, and TraceRecorder catches sync throw + rejected promise + Zod failure. Evidence output_tail shows the simulated-port-failure warnings, corroborating the swallow path. | 01KYKWNGC07ZS7JCDE7AHQ1F80 (T2 deny instrumentation + throwing-recorder test) |
| AC-TRACE-4 | 84 | 6 passes (4 attested); output_tail names the read/unread/hit/zero-hit case and --raw-queries gating. T4 claimed adding a kind='feed' row oracle; file total grew 5→7 tests, but no output_tail names a feed test, so that fix is inferred, not shown. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 trace stats verb), 01KYM95PEQ5F3JG9TE0YPE88MR (T4 feed-row oracle claim) |
| AC-TRACE-5 | 80 | 5 passes (4 attested) covering age-bounded deletion, idempotence, and trace.enabled=false disabling both paths. Bounded-batch loop visible in trace-retention.ts. T4's prune-await-on-close fix lives in app.ts, which is truncated — unverified. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 startup prune), 01KYM95PEQ5F3JG9TE0YPE88MR (T4 prune-completion fix (app.ts unseen)) |
| AC-TRACE-6 | 88 | 5 passes (4 attested); output_tail explicitly asserts stats reads emit ZERO trace rows. Diff corroborates: commands/trace.ts delegates to TraceStatsService and never routes through CorpusService.get/search. | 01KYKWNGR47MWF2NBY7RSZVYHM (T3 no-recursion regression) |
| AC-TRACE-7 | 62 | 5 passes (4 attested), but the happy path is a proxy: output_tail in the LATEST (T4) run still reads "a SEPARATE local bun:sqlite handle on a Turso-replica-shaped file ... (mirrors app.ts's ... wiring)". T4 claimed replacing this with the real createApp Turso branch; the unchanged title contradicts… | 01KYKWNFZ9EE2HGCN5TPJ8D56X (T1 sync-push absence + mirror test), 01KYM95PEQ5F3JG9TE0YPE88MR (T4 item 5 claimed real-wiring rewrite; output_tail unchanged) |

## Gaps

- The AC requires that in sync mode trace writes land via the separate local handle. The oracle instead asserts that a hand-constructed bun:sqlite handle on a replica-shaped file supports the schema — a mirror of app.ts's wiring, not the wiring itself. app.ts is truncated, so the actual Turso composition path is unverified in these materials.
- T4's task description claims item 5 replaced the mirror with the REAL createApp Turso composition, but T4's own AC-TRACE-7 output_tail still prints the pre-T4 title '...SEPARATE local bun:sqlite handle on a Turso-replica-shaped file ... (mirrors app.ts's ApiKeyStore-precedent wiring, T3)' with the same 2 pass / 8 filtered counts. The claim and the oracle output disagree.
- T4 item 2 added a kind='feed' row oracle, but no evidence record names it; only the aggregate 'filtered out' count (3→5) hints at new tests. Delivery is inferred, not evidenced.
- T4 items 3 and 4 (deny_retry_gap complexity, prune completion on close) touch only truncated files and have no dedicated oracle; every AC oracle would pass identically whether or not those fixes exist.
- InMemoryStore.countTraceDenyByCheckpoint round-trips its group key through `${checkpoint} ${layer}` + split(' '), which mis-splits any checkpoint containing a space; SQLite/Turso GROUP BY paths do not share this defect, so the test double can silently diverge from production.

## Recommendations

- Re-open AC-TRACE-7: construct the real Turso composition (config sync.enabled + file: remote_url + LORE_SYNC_TOKEN) through createApp, assert trace rows land on the local handle, and re-run the oracle so the output_tail shows a new test title.
- When a hardening task claims to replace an existing test, require the re-run evidence's output_tail to show a changed test name or count; treat an unchanged tail as unverified.
- Bind each hardening item to its own named oracle (feed-row assertion, prune-on-close ordering, deny_retry_gap grouping) rather than re-running the pre-existing AC oracles.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 87139ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/tests/unit/service/trace-recorder.test.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/trace-stats-service.ts, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/trace-stats.bun.test.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/trace-stats-service.ts, diff:packages/lore/tests/integration/cli/trace-stats.bun.test.ts, diff:packages/lore/tests/unit/service/trace-stats-service.test.ts
- Reasoning clipped for: AC-TRACE-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.72 | evidence | All 7 ACs pass with 4 attested runs each and the visible diff matches the AC statements; AC-TRACE-7's sync-mode happy path is satisfied by a proxy rather than real composition. |
| evidence_integrity | 78 | 0.7 | evidence | 0 fails, 0.70 attested ratio, output_tail present on most records. Docked: T4's AC-TRACE-7 rewrite claim is contradicted by an unchanged test title, and 5 T4 records are self-reported. |
| scope_fidelity | 86 | 0.75 | evidence | P1/P2/P3 map cleanly to T1/T2/T3 and the diff. T4 adds hardening beyond the plan's declared phases, but it is traced to a linked assessment doc and stays inside SPEC-102. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TRACE-7 | The AC requires that in sync mode trace writes land via the separate local handle. The oracle instead asserts that a hand-constructed bun:sqlite handle on a replica-shaped file supports the schema — a mirror of app.ts's wiring, not the wiring itself. app.ts is truncated, so the actual Turso composition path is unverified in these materials. |
| evidence_integrity | major | AC-TRACE-7 | T4's task description claims item 5 replaced the mirror with the REAL createApp Turso composition, but T4's own AC-TRACE-7 output_tail still prints the pre-T4 title '...SEPARATE local bun:sqlite handle on a Turso-replica-shaped file ... (mirrors app.ts's ApiKeyStore-precedent wiring, T3)' with the same 2 pass / 8 filtered counts. The claim and the oracle output disagree. |
| evidence_integrity | minor | AC-TRACE-4 | T4 item 2 added a kind='feed' row oracle, but no evidence record names it; only the aggregate 'filtered out' count (3→5) hints at new tests. Delivery is inferred, not evidenced. |
| evidence_integrity | minor | — | T4 items 3 and 4 (deny_retry_gap complexity, prune completion on close) touch only truncated files and have no dedicated oracle; every AC oracle would pass identically whether or not those fixes exist. |
| outcome | minor | — | InMemoryStore.countTraceDenyByCheckpoint round-trips its group key through `${checkpoint} ${layer}` + split(' '), which mis-splits any checkpoint containing a space; SQLite/Turso GROUP BY paths do not share this defect, so the test double can silently diverge from production. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Re-open AC-TRACE-7: construct the real Turso composition (config sync.enabled + file: remote_url + LORE_SYNC_TOKEN) through createApp, assert trace rows land on the local handle, and re-run the oracle so the output_tail shows a new test title. | The current oracle is a mirror; an app.ts wiring regression would not fail it. |
| process | When a hardening task claims to replace an existing test, require the re-run evidence's output_tail to show a changed test name or count; treat an unchanged tail as unverified. | T4's item-5 claim passed review despite byte-identical oracle output. |
| plan | Bind each hardening item to its own named oracle (feed-row assertion, prune-on-close ordering, deny_retry_gap grouping) rather than re-running the pre-existing AC oracles. | Three of five T4 items are currently unfalsifiable by any recorded oracle. |

## Unverifiable Materials

- packages/lore/src/app.ts: Truncated from the diff. Composition-root Turso separate-handle wiring, TraceRecorder/TraceStatsService wiring, and T4's prune-await-on-close fix cannot be inspected.
- packages/lore/src/service/trace-stats-service.ts: Truncated. Aggregation shape, never-read/zero-hit derivation and T4's O(n+m) deny_retry_gap regrouping are unverified.
- packages/lore/tests/integration/cli/trace-stats.bun.test.ts and tests/unit/store/trace-events.bun.test.ts bodies: Truncated. Only filtered output_tail lines are visible, so assertion strength (notably the claimed feed-row oracle) cannot be checked.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 5 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.70
