---
id: KN-374
type: knowledge
role: knowledge
title: "Assessment: Implementation — worktree-derived actor identity (SPEC-104) (2026-07-28)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-10-23
tags: []
parent: PLAN-107
links:
  - {id: PLAN-107, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYKX9XQSBB4J353KE2FR1P59`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ACTOR-1 | 92 | Attested bun-test run by agent:main-orchestrator with output tail showing 2 named passes; diff shows detectWorktreeDerivedActor + wrapper tier and tests assert {agent:<branch>, worktree-derived} plus empty stderr, slash-branch verbatim, nested-dir upward walk. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [1] self, [7] attested with output tail) |
| AC-ACTOR-2 | 92 | Attested run shows both --by and $LORE_ACTOR passes. Implementation short-circuits on any non-os-fallback core source, so precedence is structurally guaranteed, not just asserted. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [2], [11] attested) |
| AC-ACTOR-3 | 90 | Attested run shows OS-username + byte-identical warning-text assertions passing; test pins the exact warning string and the once-per-process guard. 'Byte-identical to today' is asserted against a literal, not a captured baseline, but that is a reasonable proxy. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [3], [8] attested) |
| AC-ACTOR-4 | 90 | Attested run covers detached HEAD, malformed .git, missing gitdir target, missing HEAD, bare-SHA HEAD, no .git in ancestry — each with not.toThrow(). Try/catch in detector backs the fail-open contract. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [4], [9] attested) |
| AC-ACTOR-5 | 85 | Attested run: 1 pass, 5 expect calls; test drives claim.run() in a real worktree and verifies durable claim.by == agent:<branch>. identitySource='worktree-derived' is only proven indirectly (no warning + success); the persisted identitySource value itself is never read back. | task-t1-worktree-derivation-tier-in-resolveactorwithsource (evidence [5], [10] attested) |

## Gaps

- packages/lore/tests/integration/dashboard-command.bun.test.ts and static-serving.bun.test.ts (plus the omitted dashboard-assets-loader.bun.test.ts) belong to spec-dashboard-production-packaging, not SPEC-104. They are self-described TDD-RED suites expected to fail against current code, yet land in this bundle with no declaring task and outside the plan's stated anchors.
- Task T2 (changed-tests.ts porcelain fix + 14 worktree-cwd-fragile assertion repairs) is archived on 4 self-reported evidence records with 0 attestation, and none of its claimed file edits appear in the diff or the truncation manifest. Its pass claims are unverifiable from these materials.
- The AC-ACTOR-5 test asserts claim.by === agent:<branch> and empty stderr, but never reads the persisted identitySource. The 'identitySource worktree-derived' half of the AC rests on inference plus a documented `as ActorSource` cast whose inertness depends on gate-predicates.ts behavior not shown here.
- detectWorktreeDerivedActor's shape test (.git is a regular file with gitdir: pointer) also matches git submodule checkouts, which would derive agent:<branch> from a submodule's HEAD. No fixture covers this false-positive class.
- Shadowing @lore/core/node's resolveActorWithSource in the CLI adapter, while three other call sites keep importing the core version, creates a surface-dependent identity split that the spec's 'MCP unaffected' note covers only partially (CorpusService and gate-bypass-audit are asserted out of scope without evidence).

## Recommendations

- Reject bundles whose diff contains new test files with no owning task in the bundle; require every added path to map to a declared anchor or an explicit drift note.
- Require at least one attested oracle run before archiving fallout tasks, and include their diff hunks in the audit bundle.
- Add a follow-up task to widen @lore/core/node's ActorSource and remove the `as ActorSource` cast in claim.ts, or record the cast as an accepted, tested invariant.
- State explicitly whether a git submodule working tree should be treated as a linked worktree, and add the fixture to AC-ACTOR-4's boundary set.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 74652ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/dashboard-assets-loader.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.8 | evidence | All five ACs attested green with output tails; diff shows a coherent, fail-open, subprocess-free implementation matching the stated tier order. Minor indirection in AC-ACTOR-5's identitySource proof. |
| evidence_integrity | 74 | 0.75 | evidence | T1 well attested (5 attested runs + tails, tsc pass). T2 wholly self-reported (0/4 attested) and its claimed edits are absent from the diff. Overall attested ratio 0.33. |
| scope_fidelity | 52 | 0.85 | evidence | Two large unrelated F5a dashboard RED test files (plus one omitted) landed in a bundle whose declared anchors are utils.ts + claim.ts; no task or plan note explains them. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | packages/lore/tests/integration/dashboard-command.bun.test.ts and static-serving.bun.test.ts (plus the omitted dashboard-assets-loader.bun.test.ts) belong to spec-dashboard-production-packaging, not SPEC-104. They are self-described TDD-RED suites expected to fail against current code, yet land in this bundle with no declaring task and outside the plan's stated anchors. |
| evidence_integrity | major | — | Task T2 (changed-tests.ts porcelain fix + 14 worktree-cwd-fragile assertion repairs) is archived on 4 self-reported evidence records with 0 attestation, and none of its claimed file edits appear in the diff or the truncation manifest. Its pass claims are unverifiable from these materials. |
| outcome | minor | AC-ACTOR-5 | The AC-ACTOR-5 test asserts claim.by === agent:<branch> and empty stderr, but never reads the persisted identitySource. The 'identitySource worktree-derived' half of the AC rests on inference plus a documented `as ActorSource` cast whose inertness depends on gate-predicates.ts behavior not shown here. |
| outcome | minor | — | detectWorktreeDerivedActor's shape test (.git is a regular file with gitdir: pointer) also matches git submodule checkouts, which would derive agent:<branch> from a submodule's HEAD. No fixture covers this false-positive class. |
| scope_fidelity | minor | — | Shadowing @lore/core/node's resolveActorWithSource in the CLI adapter, while three other call sites keep importing the core version, creates a surface-dependent identity split that the spec's 'MCP unaffected' note covers only partially (CorpusService and gate-bypass-audit are asserted out of scope without evidence). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Reject bundles whose diff contains new test files with no owning task in the bundle; require every added path to map to a declared anchor or an explicit drift note. | Three F5a dashboard RED suites rode along in a SPEC-104 bundle, obscuring the audited change and adding known-failing tests. |
| process | Require at least one attested oracle run before archiving fallout tasks, and include their diff hunks in the audit bundle. | T2 archived on 0/4 attested evidence with no visible diff. |
| plan | Add a follow-up task to widen @lore/core/node's ActorSource and remove the `as ActorSource` cast in claim.ts, or record the cast as an accepted, tested invariant. | A type assertion whose safety argument lives only in a comment is a silent-break risk if actorIdentityGuard grows a second literal comparison. |
| spec | State explicitly whether a git submodule working tree should be treated as a linked worktree, and add the fixture to AC-ACTOR-4's boundary set. | The filesystem-only detection contract cannot distinguish submodule from linked worktree by shape alone. |

## Unverifiable Materials

- packages/lore/src/service/gate-predicates.ts (actorIdentityGuard): Both the claim.ts cast and the utils.ts header justify safety by asserting the guard only compares against the 'os-fallback' literal; that file is not in the materials.
- T2's edits to scripts/changed-tests.ts, tests/unit/adapters/cli-utils.test.ts, tests/unit/cli/actor-session-tier.test.ts: Not present in the diff and not listed in the truncation manifest, so the porcelain fix and the 14 repaired assertions cannot be inspected.
- @lore/core/node resolveActorWithSource / ActorSource source: The delegated explicit/env/session/os-fallback tiers and the exact os-fallback sentinel are assumed from the wrapper's usage, not read.
- Full-suite regression run after the shadowing change: Only per-AC filtered bun runs and one tsc run are attested for T1; no attested whole-suite result covering the other resolveActorWithSource consumers.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.33
