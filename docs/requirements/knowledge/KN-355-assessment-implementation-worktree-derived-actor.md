---
id: KN-355
type: knowledge
role: knowledge
title: "Assessment: Implementation — worktree-derived actor identity (SPEC-104) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-107
links:
  - {id: PLAN-107, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01KYKX9XQSBB4J353KE2FR1P59`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ACTOR-1 | 92 | Named test run passes (3 pass, 2 attested by main-orchestrator, 0 fail). Diff shows detectWorktreeDerivedActor + worktree-derived tier; tests use real git worktree fixtures and assert {agent:<branch>, worktree-derived} plus no-warning and slash-branch cases. | 01KYKX9ZNEYG4R00VTF56NME0A (T1 ev[1],[7]), 01KYM2YZCBVTA2HCRPSQEH69SW (T2 ev[5]) |
| AC-ACTOR-2 | 92 | Passing attested runs; diff delegates every named tier to core and only overrides on source==='os-fallback', so --by/$LORE_ACTOR precedence is structurally guaranteed. Tests assert both explicit and env win inside a real linked worktree. | 01KYKX9ZNEYG4R00VTF56NME0A (T1 ev[2],[11]), 01KYM2YZCBVTA2HCRPSQEH69SW (T2 ev[9]) |
| AC-ACTOR-3 | 86 | Attested pass; test asserts exact legacy warning string and once-per-process behavior against a .git-DIRECTORY fixture. 'Byte-identical' is verified for the warning text and result shape, not by a broader legacy-behavior diff, and 14 pre-existing assertions needed cwd repair. | 01KYKX9ZNEYG4R00VTF56NME0A (T1 ev[3],[8]), 01KYM2YZCBVTA2HCRPSQEH69SW (T2 ev[2],[3],[6]) |
| AC-ACTOR-4 | 93 | Attested pass; six boundary cases (detached HEAD, malformed .git, dangling gitdir, missing HEAD, bare-SHA HEAD, no .git in ancestry) each assert not.toThrow() + undefined, matching the try/catch fail-open in the diff. | 01KYKX9ZNEYG4R00VTF56NME0A (T1 ev[4],[9]), 01KYM2YZCBVTA2HCRPSQEH69SW (T2 ev[7]) |
| AC-ACTOR-5 | 80 | Attested pass; in-process claim run against a throwaway SQLite corpus asserts durable claim.by === agent:<branch> and empty stderr. But identitySource 'worktree-derived' is only inferred (no warning / gate pass), never read back from the record — the AC's literal field assertion is indirect. | 01KYKX9ZNEYG4R00VTF56NME0A (T1 ev[5],[10]), 01KYM2YZCBVTA2HCRPSQEH69SW (T2 ev[8]) |

## Gaps

- The test verifies claim.by === agent:<branch> and empty stderr, but never reads back identitySource. That the recorded/threaded identitySource is literally 'worktree-derived' is inferred from the claim succeeding without an os-fallback warning, not asserted.
- Commit b81ca31 fixes a porcelain-path parsing bug in scripts/changed-tests.ts and repairs 14 assertions across cli-utils.test.ts and actor-session-tier.test.ts — real, tested, and explained, but outside the plan's declared anchors (utils.ts, commands/claim.ts).
- claim.ts casts resolvedActor.source to @lore/core/node's narrower ActorSource rather than widening the shared union, deliberately to respect file anchors. The claim that the cast is inert depends on gate-predicates.ts::actorIdentityGuard, which is not in the materials.
- Attested evidence ratio is 0.50. The typecheck runs and the broad regression runs (94 vitest + 5 bun from a main-checkout-shape clone) are self-reported by the implementing agents; only the five per-AC bun runs carry main-orchestrator attestation with output tails.

## Recommendations

- Add a follow-up task to widen ActorSource in @lore/core/node and delete the documented cast in commands/claim.ts.
- Before landing a change that makes a previously-defaulted parameter (process.cwd()) semantically load-bearing, grep all existing callers/assertions relying on the old default and fold the repairs into the same task.
- Require an attested (orchestrator-run) full-suite + typecheck run on the final merged state, not just per-AC filtered bun runs.
- For AC-ACTOR-5, state the observable that proves identitySource='worktree-derived' (a readable field, a gate outcome, or emitted metadata) so the test can assert it directly.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 45212ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.8 | evidence | All 5 ACs pass named script runs; diff implements the tier cleanly (delegate-then-override, fail-open). Minor: AC-ACTOR-5 asserts identitySource only indirectly. |
| evidence_integrity | 78 | 0.75 | evidence | Every AC has an attested main-orchestrator run with real output tails, plus tsc. Attested ratio 0.50; full-suite/typecheck runs are self-reported only. |
| scope_fidelity | 76 | 0.75 | evidence | Core change stays inside declared utils.ts/claim.ts anchors (cast documented). Drift: T2 adds an unrelated scripts/changed-tests.ts fix plus repairs to two other test suites. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-ACTOR-5 | The test verifies claim.by === agent:<branch> and empty stderr, but never reads back identitySource. That the recorded/threaded identitySource is literally 'worktree-derived' is inferred from the claim succeeding without an os-fallback warning, not asserted. |
| scope_fidelity | minor | — | Commit b81ca31 fixes a porcelain-path parsing bug in scripts/changed-tests.ts and repairs 14 assertions across cli-utils.test.ts and actor-session-tier.test.ts — real, tested, and explained, but outside the plan's declared anchors (utils.ts, commands/claim.ts). |
| scope_fidelity | minor | — | claim.ts casts resolvedActor.source to @lore/core/node's narrower ActorSource rather than widening the shared union, deliberately to respect file anchors. The claim that the cast is inert depends on gate-predicates.ts::actorIdentityGuard, which is not in the materials. |
| evidence_integrity | minor | — | Attested evidence ratio is 0.50. The typecheck runs and the broad regression runs (94 vitest + 5 bun from a main-checkout-shape clone) are self-reported by the implementing agents; only the five per-AC bun runs carry main-orchestrator attestation with output tails. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a follow-up task to widen ActorSource in @lore/core/node and delete the documented cast in commands/claim.ts. | The cast is currently safe only because actorIdentityGuard compares against one literal; a future guard change would silently mistype. |
| process | Before landing a change that makes a previously-defaulted parameter (process.cwd()) semantically load-bearing, grep all existing callers/assertions relying on the old default and fold the repairs into the same task. | 14 pre-existing assertions broke post-landing, requiring a separate fallout task. |
| process | Require an attested (orchestrator-run) full-suite + typecheck run on the final merged state, not just per-AC filtered bun runs. | Attested ratio 0.50; broad regression coverage is currently self-reported. |
| spec | For AC-ACTOR-5, state the observable that proves identitySource='worktree-derived' (a readable field, a gate outcome, or emitted metadata) so the test can assert it directly. | The current AC is verified by proxy signals, weakening its guarantee. |

## Unverifiable Materials

- gate-predicates.ts::actorIdentityGuard: Not present in the diff; the claim that the ActorSource cast in claim.ts is functionally inert rests entirely on a code comment about this file.
- @lore/core/node's resolveActorWithSource and ActorSource definition: Not in the diff; tier delegation and 'byte-identical legacy behavior' for explicit/env/session depend on unseen core behavior.
- Full-suite results on the merged final state: Only self-reported runs (typecheck, 94 vitest + 5 bun from a standalone clone) exist; no attested full-suite run in the materials.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 4 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.50
