---
id: KN-053
type: knowledge
role: knowledge
title: "Assessment: SPEC-044 Implementation — staleness probes (2026-07-12)"
status: approved
priority: medium
created: 2026-07-12
updated: 2026-07-14
tags: []
parent: PLAN-028
links:
  - {id: PLAN-028, type: informs}
---
# Assessment: met (90/100)

Scope: plan `01KXAK50QPQ8SXN9D1YFXHNVKW`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SP-1 | 92 | Pure-layer test (staleness.test.ts, 23 tests) passes under both agent and independent proxy attestation; diff shows selectProbeCandidates with the exact filter/sort/limit invariants and stalenessVerdictSchema refinements. | 01KXAK5KQRA52KGPM176AJF188 (T1 [1],[10]) |
| AC-SP-2 | 90 | judgment-kind.test.ts (9 tests) passes, attested. Diff confirms validateKindDecisionInvariant ordered before validateEscalateInvariant and optional kind read via ?? 'review'. Migration/regression asserted by test. | 01KXAK5KQRA52KGPM176AJF188 (T1 [2],[11]) |
| AC-SP-3 | 90 | staleness-probe-service.test.ts (6 tests) passes, attested. Service file truncated but batch-orchestration behavior evidenced by counting-oracle test; VERSION_ACTION_AUDIT_FAMILY exclusion claimed and covered. | 01KXAK5KQRA52KGPM176AJF188 (T1 [3],[12]) |
| AC-SP-4 | 90 | staleness-ai-provider.test.ts (11 tests) passes, attested. Prompt/parse/retry/enum-error paths covered; staleness-template.ts truncated but test-verified. | 01KXAK5KQRA52KGPM176AJF188 (T1 [4],[13]) |
| AC-SP-5 | 91 | staleness-escalation.test.ts (5 tests) passes under both recorders. Diff shows repair-command rendering with resolved --superseded-by vs unresolved note, never auto-invalidation. | 01KXAK65CGFFTGKVNAF01RDB6J (T2 [1],[9]) |
| AC-SP-6 | 90 | cli-staleness.bun.test.ts (10 tests) passes under both recorders with spawned dist binary + fake claude-cli fixture. Exit codes 0/2/3/4/6 and --list/no-provider paths covered. | 01KXAK65CGFFTGKVNAF01RDB6J (T2 [2],[10]) |
| AC-SP-7 | 90 | mcp-staleness.test.ts (10 tests) passes attested; mcp-tools.test.ts diff bumps expectedTools 29→30 with lore_staleness_probe. Payload-deep-equals-CLI guaranteed by shared builders in staleness-flow. | 01KXAK65CGFFTGKVNAF01RDB6J (T2 [3],[11]) |
| AC-SP-8 | 90 | review-superseded-candidate.test.ts (3 tests) passes attested. review-render.ts diff shows renderSupersededCandidateNudgeBlock returns '' when field absent (byte-identical regression) else nudge/note. | 01KXAK65CGFFTGKVNAF01RDB6J (T2 [4],[12]) |
| AC-SP-9 | 90 | validity-service.test.ts (23 tests) passes attested. Calibration port join (wired/unwired/bare-construction/--undo/holds) covered; validity-service.ts truncated but test-verified. | 01KXAK5KQRA52KGPM176AJF188 (T1 [5],[14]) |
| AC-SP-10 | 92 | config-staleness.test.ts (18 tests) passes attested. Diff shows ai.staleness (12000/20) and workflow.staleness (5/14) strict Zod with int/positive/nonnegative guards and resolveStalenessDefaults. | 01KXAK5KQRA52KGPM176AJF188 (T1 [6],[15]) |
| AC-SP-11 | 89 | calibration-kind.test.ts (4 tests) passes attested; asserts two stat rows (never one pooled Wilson bound) for review+staleness on same doc_type/prompt-version. computeCalibrationStats source truncated but test-verified. | 01KXAK5KQRA52KGPM176AJF188 (T1 [7],[16]) |
| AC-SP-12 | 90 | staleness-visibility.test.ts (4 tests) passes attested. status.ts/bootstrap.ts diffs confirm open_stale_candidates spliced via the SAME listFreshStalenessEscalates call (single derivation site). | 01KXAK65CGFFTGKVNAF01RDB6J (T2 [5],[13]) |
| AC-SP-13 | 84 | Owner-executed live probe on throwaway corpus with real provider: K1 (in_degree 1) selected before K2, verdict recorded, no auto-invalidation. Single unattested human run; output tail truncated mid-listing but core claims shown. | 01KXAK65CGFFTGKVNAF01RDB6J (T2 [14] manual) |

## Gaps

- Human owner-executed live probe is single-source (no independent attestation) and its captured output tail is truncated before the --list/status/invalidate surface assertions render; the 'K1 selected first / no auto-invalidation' claims rely on the shown 'decision: approve, in_degree: 1, total_candidates: 2' lines plus the AC statement.
- Core service/store/migration source (16 files) is truncated from the diff; the one-call-per-batch, audit-exclusion, and doc-immutability guarantees are verified only transitively via passing tests, not by direct inspection of staleness-probe-service.ts / migration-005.ts.

## Recommendations

- Require full transcript capture (not a truncated tail) for human/owner-executed ACs so the surfacing assertions are independently reviewable.
- Add a knowledge-capture deliverable recording the staleness-vs-review kind-filter regression seam.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 51950ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:packages/core/tests/config-staleness.test.ts, diff:packages/core/tests/staleness.test.ts, diff:packages/lore/src/adapters/mcp/CLAUDE.md, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/ai/staleness-template.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/flows/staleness-flow.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/ai-provider-service.ts, diff:packages/lore/src/service/judgment-service.ts, diff:packages/lore/src/service/staleness-probe-service.ts, diff:packages/lore/src/service/validity-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/migrations/migration-005.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/adapters/cli-staleness.bun.test.ts, diff:packages/lore/tests/unit/adapters/mcp-session-tools.test.ts, diff:packages/lore/tests/unit/adapters/mcp-staleness.test.ts, diff:packages/lore/tests/unit/service/calibration-kind.test.ts, diff:packages/lore/tests/unit/service/judgment-kind.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/lore/tests/unit/service/review-superseded-candidate.test.ts, diff:packages/lore/tests/unit/service/staleness-ai-provider.test.ts, diff:packages/lore/tests/unit/service/staleness-escalation.test.ts, diff:packages/lore/tests/unit/service/staleness-probe-service.test.ts, diff:packages/lore/tests/unit/service/staleness-visibility.test.ts, diff:packages/lore/tests/unit/service/validity-service.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/sqlite-store.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 91 | 0.86 | evidence | All 13 ACs pass their named oracles; full vitest (3498) + bun (803) suites green; typecheck clean. Diff matches AC intent where visible. |
| evidence_integrity | 88 | 0.82 | evidence | Every script AC independently re-run by daniel-via-agent-proxy; live AC-SP-13 with real provider. Attested ratio 0.40; human run single-source and tail-truncated. |
| scope_fidelity | 92 | 0.85 | evidence | Two serial tasks map cleanly to declared D1-D15/AC set; no ac_scope restriction; diff additions are additive and regression-guarded, no visible drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-SP-13 | Human owner-executed live probe is single-source (no independent attestation) and its captured output tail is truncated before the --list/status/invalidate surface assertions render; the 'K1 selected first / no auto-invalidation' claims rely on the shown 'decision: approve, in_degree: 1, total_candidates: 2' lines plus the AC statement. |
| outcome | minor | AC-SP-3 | Core service/store/migration source (16 files) is truncated from the diff; the one-call-per-batch, audit-exclusion, and doc-immutability guarantees are verified only transitively via passing tests, not by direct inspection of staleness-probe-service.ts / migration-005.ts. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require full transcript capture (not a truncated tail) for human/owner-executed ACs so the surfacing assertions are independently reviewable. | AC-SP-13's evidence tail cuts off mid-listing, weakening the strongest independence claim. |
| plan | Add a knowledge-capture deliverable recording the staleness-vs-review kind-filter regression seam. | 0 knowledge docs captured for a change whose main risk is a subtle default-kind regression. |

## Unverifiable Materials

- 16 truncated production files (staleness-probe-service.ts, migration-005.ts, staleness-flow.ts, store impls, etc.): Omitted from diff per truncation manifest; behavior confirmed only via passing tests, not direct code inspection.
- AC-SP-13 full CLI output (list/status/invalidate lines): Evidence output_tail truncated mid-render; final surface assertions not shown.

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.40
