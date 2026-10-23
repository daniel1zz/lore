---
id: KN-752
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
# Assessment: partially_met (78/100)

Scope: plan `01M5A58HR4K3GB4Z342YJP3E2D`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DJ-1 | 80 | Expected-fail followed by attested passes (3/3, twice) of dj-own-diff-scope. The diff takes the merge-base diff, checks collisions via anchorsOverlap, records outside_anchors and refuses before the worktree or lease exist. Test body and the made-red mutation are unseen; the coverage table shows 0. | 01M5A58X8ARTXG720V0843G7MZ (evidence [1],[4],[9]) |
| AC-DJ-2 | 80 | Red then green (2/2, twice). reviewCoChange runs on the own diff, and outside_anchors is only recorded, never refused, so case (2) can land. The BR-1347 refusal is built in own-diff-judgment.ts. The red-once mutation is unevidenced. | 01M5A58X8ARTXG720V0843G7MZ (evidence [2],[5],[10]) |
| AC-DJ-4 | 78 | Red then green (7/7). trail-review was removed from session.ts, and unknown verbs now exit 2 before the corpus loads. The ignore probe moved to git-ignore-probe.ts. The stop-turn-review.mjs, session-trail.mjs and helper-scope-review.ts deletion diffs are unseen. The dedup against main-session findi… | 01M5A58WGGGSXYQAEG720ZXYBV (evidence [1],[2]) |
| AC-DJ-3 | 78 | Red then green, but only 1 test covers all three cases. Both BranchOwnershipReader and recordLanding now count plan integration-branch members, through the shared branch-membership.ts. BR-1348 refuses a branch with no task. The red-once mutation is unevidenced. | 01M5A58X8ARTXG720V0843G7MZ (evidence [3],[6],[11]) |

## Gaps

- There is no evidence that the 'made red once' green-but-broken mutation checks required by AC-DJ-1..4 were run.
- The post-landing steps (deleting the judged.json markers, lore rule apply, lore setup --yes) have no recorded output.

## Recommendations

- Record a failing run against the mutated code (e.g. a diff base of main's tip, or the trail-review spawn restored) as evidence for each AC that claims 'made red once'.
- Make each verify command identical to the command used for the evidence (drop or standardize the `&& echo` suffix).

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 31752ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/helpers/own-diff-fixture.ts, diff:packages/lore/tests/integration/dj-co-change.bun.test.ts, diff:packages/lore/tests/integration/dj-integration-branch-tasks.bun.test.ts, diff:packages/lore/tests/integration/dj-own-diff-scope.bun.test.ts, diff:assets/hooks/lib/top-level-symbols.mjs, diff:package.json, diff:scripts/sync-hook-top-level-symbols.ts, diff:packages/lore/tests/helpers/claim-branch-task.ts, diff:packages/lore/tests/helpers/own-diff-fixture.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/dj-co-change.bun.test.ts, diff:packages/lore/tests/integration/dj-integration-branch-tasks.bun.test.ts, diff:packages/lore/tests/integration/dj-own-diff-scope.bun.test.ts, diff:packages/lore/tests/integration/integrate-complete-coverage.test.ts, diff:packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts, diff:packages/lore/tests/integration/lore-integrate-corpus-snapshot.test.ts, diff:packages/lore/tests/integration/lore-integrate-requires-guard.test.ts, diff:packages/lore/tests/integration/lore-integrate-same-session-lease.test.ts, diff:packages/lore/tests/integration/lore-integrate.test.ts, diff:packages/lore/tests/integration/dj-turn-end-no-helper-review.bun.test.ts, diff:assets/hooks/lib/session-trail.mjs, diff:assets/hooks/stop-turn-review.mjs, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/helper-scope-review.ts, diff:packages/lore/tests/integration/cli/session-trail-review-co-change.test.ts, diff:packages/lore/tests/integration/cli/session-trail-review-helper-scope.test.ts, diff:packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts, diff:packages/lore/tests/integration/hooks/stop-turn-review-spawn-gating.test.ts, diff:packages/lore/tests/integration/hooks/trail-review-stub.ts, diff:packages/lore/tests/unit/service/helper-scope-review.test.ts, diff:packages/lore/tests/integration/hooks/turn-review-harness.ts
- Reasoning clipped for: AC-DJ-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.6 | evidence | The core judgment, the landing footprint, the integration-branch membership and the trail-review removal are all visible and their tests pass. The hook deletions are unseen. |
| evidence_integrity | 70 | 0.6 | evidence | Attested red-then-green runs plus typecheck and the floor check. The coverage table shows 0, and the mutation checks and post-landing steps have no evidence. |
| scope_fidelity | 82 | 0.6 | evidence | Changes stay within the plan. The shared symbol extractor moved to core with a generated hook copy. Edits to recordLanding and the config comments follow from the ACs. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | There is no evidence that the 'made red once' green-but-broken mutation checks required by AC-DJ-1..4 were run. |
| evidence_integrity | minor | — | The post-landing steps (deleting the judged.json markers, lore rule apply, lore setup --yes) have no recorded output. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Record a failing run against the mutated code (e.g. a diff base of main's tip, or the trail-review spawn restored) as evidence for each AC that claims 'made red once'. | Without it, the green-but-broken guard cannot be verified. |
| spec | Make each verify command identical to the command used for the evidence (drop or standardize the `&& echo` suffix). | The deterministic coverage currently reports 0 passes despite the passing runs. |

## Unverifiable Materials

- assets/hooks/stop-turn-review.mjs and assets/hooks/lib/session-trail.mjs diffs: Omitted, so the removal of step 4b and the porcelain check with deduplication cannot be inspected.
- dj-*.bun.test.ts test bodies: Omitted, so I cannot confirm the assertions match the AC fixtures, including the merge-base fixture for X3.
- lore rule apply / setup output: No evidence was supplied for the main-agent steps after landing.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] claimedNamesOf in packages/lore/src/service/branch-membership.ts counts audit rows with undefined doc_id for every task, which can widen branch ownership. — "packages/lore/src/service/branch-membership.ts" not found at commit cc9202bf3acb02fc00b236a1d34038f893b52496

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
