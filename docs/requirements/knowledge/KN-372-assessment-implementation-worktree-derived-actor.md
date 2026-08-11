---
id: KN-372
type: knowledge
role: knowledge
title: "Assessment: Implementation — worktree-derived actor identity (SPEC-104) (2026-07-28)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
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
| AC-ACTOR-1 | 93 | Two passing script runs (1 attested by main-orchestrator, showing named test titles). Diff adds detectWorktreeDerivedActor + wrapper; tests use real `git worktree add` fixtures, assert {agent:<branch>, worktree-derived}, empty stderr, nested-dir walk, and slash-branch verbatim. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [1] self, [7] attested) |
| AC-ACTOR-2 | 92 | Attested run passes; wrapper delegates to core first and only overrides on source==='os-fallback', so explicit/env structurally win. Tests assert --by and $LORE_ACTOR inside a real linked worktree, plus no-warning. Session tier precedence not re-asserted in this file (covered by pre-existing suite). | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [2] self, [11] attested) |
| AC-ACTOR-3 | 92 | Attested run passes. Test asserts the EXACT legacy warning string and {OS username, os-fallback} in a .git-DIRECTORY main checkout, plus once-per-process warning. 'Byte-identical' is verified against a literal string in the test, not against pre-change output, but that literal matches the untouched… | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [3] self, [8] attested) |
| AC-ACTOR-4 | 94 | Attested run passes. Six boundary cases: detached HEAD, malformed .git, dangling gitdir pointer, gitdir missing HEAD, bare-SHA HEAD, no .git in ancestry — each asserted .not.toThrow() and undefined, with a catch-all try/catch in the implementation for IO races. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [4] self, [9] attested) |
| AC-ACTOR-5 | 76 | Attested run passes (1 test, 5 expects): claim via real run() in a worktree, durable extra.claim.by === agent:<branch>, no stderr. But identitySource 'worktree-derived' itself is never read back — it is inferred from absence of the os-fallback warning. Only 1 test case for the e2e AC. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [5] self, [10] attested) |

## Gaps

- The e2e claim test asserts extra.claim.by === agent:<branch> and empty stderr, but never reads back or spies on the identitySource actually threaded into ClaimOpts. The AC's 'with identitySource worktree-derived' half is inferred, not observed.
- claim.ts casts `resolvedActor.source as ActorSource` past an unwidened core union. Safety rests on the prose claim that actorIdentityGuard only compares against 'os-fallback'; gate-predicates.ts is not in the materials and no test pins that behavior for the new literal.
- T2 fixed a porcelain-path parsing bug in scripts/changed-tests.ts — a genuine pre-existing defect, but outside the plan's declared utils.ts/commands/claim.ts anchors and unrelated to SPEC-104's ACs.
- utils.ts shadows @lore/core/node's resolveActorWithSource rather than extending it, leaving CorpusService, gate-bypass-audit.ts and MCP tools.ts on the 4-tier behavior. Intentional and documented, but creates surface-dependent identity resolution with no test pinning the split.
- T2 (changed-tests fix + 14 test repairs, incl. a claimed 94/94 vitest run and a standalone-clone verification) carries zero attested evidence — all four oracle records are self-reported by agent:spec104-fallout.

## Recommendations

- Add an assertion to the AC-ACTOR-5 test that observes the identitySource passed to claim (spy on ClaimOpts or persist/read it back), so the AC's second clause is directly evidenced.
- Schedule a follow-up to widen @lore/core/node's ActorSource union and drop the documented cast in claim.ts; decide explicitly whether CorpusService/MCP should also gain the worktree tier.
- Require orchestrator attestation on at least one oracle run per task, including remediation/fallout tasks, before archiving.
- When a change makes an implicit ambient input (process.cwd(), env) load-bearing, run the full pre-existing suite from both the worktree and main-checkout shapes before landing.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 57524ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-ACTOR-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.8 | evidence | All 5 ACs pass with attested runs; implementation in the diff matches the AC statements. Minor shortfall: AC-ACTOR-5 asserts claim.by, not identitySource itself. |
| evidence_integrity | 78 | 0.75 | evidence | Every AC has an independently attested run with real output tails; but attested ratio is 0.33 overall and the T2 fallout task's 4 runs are entirely self-reported. |
| scope_fidelity | 76 | 0.7 | evidence | T1 stayed on utils.ts + claim.ts anchors. T2 extended to scripts/changed-tests.ts (unrelated pre-existing bug) and two test files — explained as fallout, still drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-ACTOR-5 | The e2e claim test asserts extra.claim.by === agent:<branch> and empty stderr, but never reads back or spies on the identitySource actually threaded into ClaimOpts. The AC's 'with identitySource worktree-derived' half is inferred, not observed. |
| outcome | minor | — | claim.ts casts `resolvedActor.source as ActorSource` past an unwidened core union. Safety rests on the prose claim that actorIdentityGuard only compares against 'os-fallback'; gate-predicates.ts is not in the materials and no test pins that behavior for the new literal. |
| scope_fidelity | minor | — | T2 fixed a porcelain-path parsing bug in scripts/changed-tests.ts — a genuine pre-existing defect, but outside the plan's declared utils.ts/commands/claim.ts anchors and unrelated to SPEC-104's ACs. |
| scope_fidelity | minor | — | utils.ts shadows @lore/core/node's resolveActorWithSource rather than extending it, leaving CorpusService, gate-bypass-audit.ts and MCP tools.ts on the 4-tier behavior. Intentional and documented, but creates surface-dependent identity resolution with no test pinning the split. |
| evidence_integrity | minor | — | T2 (changed-tests fix + 14 test repairs, incl. a claimed 94/94 vitest run and a standalone-clone verification) carries zero attested evidence — all four oracle records are self-reported by agent:spec104-fallout. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add an assertion to the AC-ACTOR-5 test that observes the identitySource passed to claim (spy on ClaimOpts or persist/read it back), so the AC's second clause is directly evidenced. | Currently the only signal for 'identitySource worktree-derived' is the absence of a warning, which would also hold under other non-os-fallback sources. |
| spec | Schedule a follow-up to widen @lore/core/node's ActorSource union and drop the documented cast in claim.ts; decide explicitly whether CorpusService/MCP should also gain the worktree tier. | A shadowed function plus an unchecked cast is a latent divergence between CLI and other surfaces. |
| process | Require orchestrator attestation on at least one oracle run per task, including remediation/fallout tasks, before archiving. | Attested ratio 0.33; T2's regression-repair claims are entirely self-reported. |
| process | When a change makes an implicit ambient input (process.cwd(), env) load-bearing, run the full pre-existing suite from both the worktree and main-checkout shapes before landing. | 14 pre-existing assertions broke and needed a separate fallout task; the failure mode was predictable from the design. |

## Unverifiable Materials

- gate-predicates.ts::actorIdentityGuard: Not in the diff or materials; the claim that it only compares against the 'os-fallback' literal (making the cast inert) cannot be checked here.
- @lore/core/node resolveActorWithSource / ActorSource definition: Not shown; the delegation contract and the exact core tier semantics are taken from the wrapper's doc comment and test behavior only.
- T2's full-suite results (94 vitest + 5 bun, standalone clone run): Self-reported by agent:spec104-fallout with no output tail or attestation in the bundle.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.33
