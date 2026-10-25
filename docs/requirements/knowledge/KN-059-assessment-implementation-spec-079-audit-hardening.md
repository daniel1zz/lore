---
id: KN-059
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-079 audit hardening (provenance + actor + chain) (2026-07-26)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-10-23
tags: []
parent: PLAN-030
links:
  - {id: PLAN-030, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KYED6NXQCMSZ0CSJQC9XX48K`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-079-1 | 87 | Canonical vitest path run twice (task agent + attested orchestrator), 12 tests green. Attested tail shows file/test count. Cannot inspect test bodies or diff to confirm the 'exactly one audit entry' and details-shape assertions are actually made. | task-t1-relationship-provenance-actor-fidelity-link-unlink-tree (evidence [1],[4] link-provenance.test.ts pass) |
| AC-079-2 | 87 | audit-actor-fidelity.test.ts passes at the canonical path, 13 tests, attested by orchestrator plus task agent. Env-chain fallback via resolveActorWithSource is claimed in the task description only; no diff to confirm CLI/MCP/HTTP threading. | task-t1-relationship-provenance-actor-fidelity-link-unlink-tree (evidence [2],[5], typecheck [3]) |
| AC-079-3 | 84 | audit-chain.bun.test.ts passes twice incl. attested run; tail shows chain-extension and independent-hash tests. The migration-009 legacy-fixture backfill sub-claim is not visible in the truncated tail, only in the task narrative. | task-t2-audit-hash-chain-store-shared-hash-fns-migration-009 (evidence [1],[4]) |
| AC-079-4 | 88 | Independent tester-agent suite passes twice (attested). Tail confirms hash_mismatch-at-id tests for actor and details tampering; DELETE chain-break and forged-row prev_link_mismatch cases are described but clipped from the visible output. | task-t4-adversarial-tamper-suite-independent-tester-audit (evidence [1],[2]) |
| AC-079-5 | 86 | audit-anchor.bun.test.ts passes twice (attested). Tail shows anchor write, --verify --json clean consumption, non-JSON output line, and an empty-table negative. The 'rewritten chain -> anchor_mismatch' case is clipped from view. | task-t3-verify-chain-walk-anchor-lore-audit-verify-chain (evidence [1],[2]) |
| AC-079-6 | 85 | in-memory-audit-chain.test.ts: 8 tests pass, attested orchestrator run with full vitest summary. 'Identical chain semantics for all write paths' is asserted by the suite name/task text; parity assertions themselves unverifiable without the file. | task-t2-audit-hash-chain-store-shared-hash-fns-migration-009 (evidence [2],[5]) |
| AC-079-7 | 80 | Attested `bun run typecheck && bun run test` recorded as pass after T5 fixed the sync-push fixture drift at migration-009. Only one full-regression run, and the tail shows unrelated HTTP suites rather than an explicit exit-0/summary line. | task-t5-sync-push-fixture-migration-chain-catches-up-to (evidence [2] build oracle pass) |

## Gaps

- No diff was provided. Nothing about the hash-chain implementation (canonical payload ordering, genesis prev_hash='', head read inside the same transaction, three-store parity, migration-009 transactional backfill) can be verified independently of the suites that were authored alongside it. Self-referential test evidence is the sole signal for a tamper-evidence feature.
- The AC explicitly requires that migration-009 backfills a legacy fixture DB into a verifiable chain. The visible output tail for audit-chain.bun.test.ts shows only chain-extension and hash-recomputation tests; the legacy-fixture backfill case is asserted in the task description alone.
- The anchor_mismatch-on-rewritten-chain case named in AC-079-5 is not present in the visible output tail (which ends mid-listing after the empty-audit-table negative).
- The build-oracle tail for `bun run typecheck && bun run test` shows dashboard/HTTP suite lines but no aggregate summary or exit status, so the pass verdict is recorder-asserted rather than visible in the captured output.
- T5 (sync-push fixture migration catch-up) was not in the plan's two-wave decomposition. It is justified — the schema-version bump in T2 broke a fixture pinned at migration-008 — but it means source files outside the plan's declared surface were edited without an ac_scope update.
- All five tasks remain status=draft, so the delivery is evidenced but not formally closed; a draft task can still be edited after its oracle run.

## Recommendations

- Require a diff (or at minimum the changed store/migration files) in the audit bundle for any AC whose subject is tamper-evidence or cryptographic integrity, where test-only evidence is inherently circular.
- Increase captured output_tail length, or record the per-test name list, so every sub-clause named in an AC statement is visibly matched to a passing test rather than inferred from the task narrative.
- When a task bumps a schema/user_version, add an explicit companion task to sweep fixture migration chains (e.g. sync-push applyMigrationsToClient) in the same wave instead of discovering it via full-suite regression.
- Mark tasks done once their oracles are attested green, and capture at least one knowledge doc for the audit-chain invariant and anchor file contract.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 57803ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.72 | evidence | All 7 ACs have passing script oracles at canonical paths, each with an attested orchestrator re-run; full regression green after the T5 fixture catch-up. |
| evidence_integrity | 78 | 0.7 | evidence | Independent re-runs by the orchestrator and an independent tester for T4 are strong; weakened by 0.44 attested ratio, clipped tails hiding key cases, and all tasks still draft. |
| scope_fidelity | 84 | 0.68 | evidence | T1-T4 match the two-wave plan. T5 is unplanned but is a documented regression fix for the plan's own AC-079-7 gate; no diff to rule out incidental drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | No diff was provided. Nothing about the hash-chain implementation (canonical payload ordering, genesis prev_hash='', head read inside the same transaction, three-store parity, migration-009 transactional backfill) can be verified independently of the suites that were authored alongside it. Self-referential test evidence is the sole signal for a tamper-evidence feature. |
| evidence_integrity | minor | AC-079-3 | The AC explicitly requires that migration-009 backfills a legacy fixture DB into a verifiable chain. The visible output tail for audit-chain.bun.test.ts shows only chain-extension and hash-recomputation tests; the legacy-fixture backfill case is asserted in the task description alone. |
| evidence_integrity | minor | AC-079-5 | The anchor_mismatch-on-rewritten-chain case named in AC-079-5 is not present in the visible output tail (which ends mid-listing after the empty-audit-table negative). |
| evidence_integrity | minor | AC-079-7 | The build-oracle tail for `bun run typecheck && bun run test` shows dashboard/HTTP suite lines but no aggregate summary or exit status, so the pass verdict is recorder-asserted rather than visible in the captured output. |
| scope_fidelity | minor | — | T5 (sync-push fixture migration catch-up) was not in the plan's two-wave decomposition. It is justified — the schema-version bump in T2 broke a fixture pinned at migration-008 — but it means source files outside the plan's declared surface were edited without an ac_scope update. |
| outcome | minor | — | All five tasks remain status=draft, so the delivery is evidenced but not formally closed; a draft task can still be edited after its oracle run. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require a diff (or at minimum the changed store/migration files) in the audit bundle for any AC whose subject is tamper-evidence or cryptographic integrity, where test-only evidence is inherently circular. | A hash chain's value lies in properties (canonicalization, transactional head read) that passing tests written by the same agent cannot independently establish. |
| process | Increase captured output_tail length, or record the per-test name list, so every sub-clause named in an AC statement is visibly matched to a passing test rather than inferred from the task narrative. | Three ACs here have named sub-cases clipped out of the visible evidence. |
| plan | When a task bumps a schema/user_version, add an explicit companion task to sweep fixture migration chains (e.g. sync-push applyMigrationsToClient) in the same wave instead of discovering it via full-suite regression. | T5 was reactive; the fixture-drift guard fired only at the AC-079-7 gate, serializing the tail of the plan. |
| process | Mark tasks done once their oracles are attested green, and capture at least one knowledge doc for the audit-chain invariant and anchor file contract. | Five draft tasks and zero knowledge docs leave the integrity contract undocumented for the next migration. |

## Unverifiable Materials

- Implementation diff (store-shared.ts hash fns, migration-009, SQLiteStore/TursoStore/InMemoryStore insert paths, AuditService.verify, CLI anchor command): diff_available: false in the bundle; no source shown, so correctness and quality are inferred from passing oracles and task prose only.
- Bodies of the six test suites cited by the ACs: Only truncated output tails with test names were provided; assertion strength (e.g. 'exactly one audit entry', chain-parity checks) could not be inspected.
- Full output of `bun run typecheck && bun run test` for AC-079-7: Tail shows unrelated HTTP suite lines and no aggregate summary or exit code.
- Knowledge documentation for the audit-chain invariant: Knowledge capture reports 0 linked docs.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.44
