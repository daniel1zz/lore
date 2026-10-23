---
id: KN-751
type: knowledge
role: knowledge
title: "Assessment: D3a: judge a branch's own diff at integrate; remove the turn-end helper review (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-217
links:
  - {id: PLAN-217, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01M5A58HR4K3GB4Z342YJP3E2D`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DJ-1 | 78 | The final AC command passed (3/3, [18]). There was an expected-fail before the implementation ([1]). Run [15] failed on a fixture claim actor-identity collision, which was later fixed. The red-once mutation (diff base switched to main's tip) is not evidenced on its own. own-diff-judgment.ts is not … | task-d3a-a-judge-a-branch-s-own-diff-against-its-tasks-anchors (evidence [1],[4],[9],[15] fail,[18] pass) |
| AC-DJ-2 | 85 | There was an expected-fail before the implementation, then repeated passes of the AC command ([16],[19]). integrate.ts reuses loadCoChangeRules from co-change-review.ts, as the plan says. The red-once run with the coverage clause dropped is not shown separately. | task-d3a-a-judge-a-branch-s-own-diff-against-its-tasks-anchors (evidence [2],[5],[10],[16],[19]) |
| AC-DJ-4 | 85 | The expected-fail ([1]) shows the trail-review spawn count was 1 before the change. The AC command later passed 7/7 ([5]). The diff deletes helper-scope-review.ts, and the session CLI exits 2 on unknown verbs before the corpus is opened. The BR-1349 porcelain check in stop-turn-review.mjs is not sh… | task-d3a-b-remove-the-turn-end-helper-review-one-shared (evidence [1],[2],[5]) |
| AC-DJ-3 | 78 | The final AC command passed ([20]) after a fixture claim failure ([17]). There was an expected-fail before the implementation ([3]). branch-membership.ts and BranchOwnershipReader are wired into both composition roots, but their logic is not shown. | task-d3a-a-judge-a-branch-s-own-diff-against-its-tasks-anchors (evidence [3],[6],[11],[17] fail,[20] pass) |

## Gaps

- There is no evidence that the merge-base-vs-main-tip mutation was made red once. Only a failure from before the implementation exists.

## Recommendations

- Require one attested evidence record for each AC's named red-once mutation, separate from the failing runs before the implementation.
- Attach evidence for the main agent's post-landing steps (rule apply output, judged.json sweep confirmation).

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 30325ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/dj-turn-end-no-helper-review.bun.test.ts, diff:assets/hooks/lib/session-trail.mjs, diff:assets/hooks/stop-turn-review.mjs, diff:packages/lore/tests/integration/cli/session-trail-review-co-change.test.ts, diff:packages/lore/tests/integration/cli/session-trail-review-helper-scope.test.ts, diff:packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts, diff:packages/lore/tests/integration/hooks/stop-turn-review-spawn-gating.test.ts, diff:packages/lore/tests/integration/hooks/trail-review-stub.ts, diff:packages/lore/tests/unit/service/helper-scope-review.test.ts, diff:packages/lore/tests/integration/hooks/turn-review-harness.ts, diff:packages/lore/tests/helpers/own-diff-fixture.ts, diff:packages/lore/tests/integration/dj-co-change.bun.test.ts, diff:packages/lore/tests/integration/dj-integration-branch-tasks.bun.test.ts, diff:packages/lore/tests/integration/dj-own-diff-scope.bun.test.ts, diff:assets/hooks/lib/top-level-symbols.mjs, diff:package.json, diff:packages/lore/src/service/own-diff-judgment.ts, diff:scripts/sync-hook-top-level-symbols.ts, diff:packages/lore/src/service/branch-membership.ts, diff:packages/lore/src/service/integrate-service.ts, diff:packages/lore/src/service/own-diff-judgment.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/helpers/claim-branch-task.ts, diff:packages/lore/tests/helpers/own-diff-fixture.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/dj-integration-branch-tasks.bun.test.ts, diff:packages/lore/tests/integration/dj-own-diff-scope.bun.test.ts, diff:packages/lore/tests/integration/integrate-complete-coverage.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/integration/lore-integrate-corpus-snapshot.test.ts, diff:packages/lore/tests/integration/lore-integrate-requires-guard.test.ts, diff:packages/lore/tests/integration/lore-integrate-same-session-lease.test.ts, diff:packages/lore/tests/integration/lore-integrate.test.ts
- Reasoning clipped for: AC-DJ-1, AC-DJ-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.6 | evidence | Every AC script command passed last with attested runs. The removal and wiring are visible in the diff. The main judgment logic is unseen. |
| evidence_integrity | 78 | 0.6 | evidence | All evidence is attested and includes expected-fail runs. Mutation red-once runs are not separated out. Two intermediate failures came from fixtures and were fixed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-DJ-1 | There is no evidence that the merge-base-vs-main-tip mutation was made red once. Only a failure from before the implementation exists. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require one attested evidence record for each AC's named red-once mutation, separate from the failing runs before the implementation. | The spec's 'made red once' clauses currently have no evidence behind them. |
| plan | Attach evidence for the main agent's post-landing steps (rule apply output, judged.json sweep confirmation). | These rule changes land the spec, and nothing confirms they happened. |

## Unverifiable Materials

- packages/lore/src/service/own-diff-judgment.ts: Omitted from the diff. It holds the core logic for BR-1346, BR-1347 and BR-1348.
- packages/lore/src/service/branch-membership.ts: Omitted. It holds the integration-branch task logic for AC-DJ-3.
- assets/hooks/stop-turn-review.mjs: Omitted. It holds the step 4b removal and the BR-1349 check.
- post-landing steps output: No record of rule apply, setup, or the judged.json sweep.
- scope_fidelity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] The BR-1349 git status --porcelain check and its de-duplication against the main-session finding live in assets/hooks/stop-turn-review.mjs, which was omitted from the diff. — "assets/hooks/stop-turn-review.mjs" was never shown to the judge (omitted from the truncated diff)

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
