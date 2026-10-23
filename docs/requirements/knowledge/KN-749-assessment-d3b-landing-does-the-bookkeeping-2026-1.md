---
id: KN-749
type: knowledge
role: knowledge
title: "Assessment: D3b: landing does the bookkeeping (2026-10-20)"
status: archived
priority: medium
created: 2026-10-20
updated: 2026-10-23
tags: []
parent: PLAN-214
links:
  - {id: PLAN-214, type: informs}
---
# Assessment: partially_met (74/100)

Scope: plan `01M5AB7M1TARWWN2DZ2CPV0FY9`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-LB-1 | 85 | refuseFirstClaimOffMain counts HEAD commits ahead of main, exempts recorded claim branches (audit and current claim), and names BR-1353, the count and the source branch. The final verify-command runs passed ([15],[17],[19]) after red runs. The file has 2 tests for 3 cases; the red-by-dropping-exemp… | 01M5AB7ZC171D5QFTBHM8QGP66 (evidence [1],[3] red; [15],[17],[19] pass) |
| AC-LB-2 | 72 | liveOthers now gives holder state: 'held claim by H since T (Nm old)'. The collision line names the path, the holder slug and the anchor. Verify run [26] passed. The lb-park test count dropped from 4 to 2, and later diff hunks remove park registration and the parked schema, so the park path is unce… | 01M5AB8007XS3ZKNWQHX5QSKH5 (evidence [1],[16],[21] red; [26] pass) |
| AC-LB-3 | 85 | The diff uses -M and parses three-token R entries into renames. anchoredDeletesOf refuses BR-1355 naming the doc and path. followMovedFiles writes one version per doc after the landing. The red run [2] showed the anchor not followed; verify run [27] passed. | 01M5AB8007XS3ZKNWQHX5QSKH5 (evidence [2],[5] red; [27] pass) |
| AC-LB-4 | 78 | completeLanding runs done for each task after main moved, logs the floor and the refusal message, and never rolls back. The red run [3] showed 'draft' not archived; verify run [28] passed. That the stdout names the exact lore evidence command depends on done's message, which the diff does not show. | 01M5AB8007XS3ZKNWQHX5QSKH5 (evidence [3],[6] red; [28] pass) |
| AC-LB-5 | 78 | definitionOfDone reuses declaredTestFileAnchors, readRedFirstDeclared and requiresNoNewTestsDeclaration, the same predicates the floors use, and is exposed on claim --json and the feed. One verify run failed on a config validation error in the fixture ([18]); a later run passed ([20]). | 01M5AB7ZC171D5QFTBHM8QGP66 (evidence [2],[4] red; [18] fail; [20] pass) |

## Gaps

- The diff ends by removing the park registration in packages/lore/src/adapters/cli/index.ts and the parked schema in packages/core/src/schemas.ts. The plan's `lore park` verb (exit code 2 when --reason is missing) may not be reachable.
- The AC-LB-5 verify command failed once on a config validation error before a later pass. Flakiness is possible.

## Recommendations

- Check the final tree for the park command registration, the schema field and the dedicated key after both parallel tasks merge.
- Add an AC that exercises `lore park` directly: exit code 2 when --reason is missing, the park releases a branch hold, and a claim unparks.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 41166ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/lb-claim-from-main.bun.test.ts, diff:packages/lore/tests/integration/lb-definition-of-done.bun.test.ts, diff:packages/lore/tests/integration/landing-lookup-integrate-naming.bun.test.ts, diff:packages/lore/tests/integration/lb-anchor-follow.bun.test.ts, diff:packages/lore/tests/integration/lb-landing-runs-done.bun.test.ts, diff:packages/lore/tests/integration/lb-park.bun.test.ts, diff:packages/lore/tests/integration/lb-anchor-follow.bun.test.ts, diff:packages/lore/tests/integration/lb-park.bun.test.ts, diff:packages/lore/src/service/own-diff-judgment.ts, diff:packages/lore/tests/integration/lb-holder-scope.bun.test.ts, diff:packages/lore/tests/integration/lb-park.bun.test.ts, diff:packages/lore/src/service/own-diff-judgment.ts, diff:packages/lore/tests/integration/lb-holder-scope.bun.test.ts, diff:packages/lore/tests/integration/lb-park.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/park.ts, diff:packages/lore/src/service/own-diff-judgment.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/integration/lb-park.bun.test.ts
- Reasoning clipped for: AC-LB-1, AC-LB-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.55 | evidence | All 5 AC tests passed at the end, but the park verb and claim-unparks (plan deliverables) appear reverted in the shown diff. |
| evidence_integrity | 82 | 0.7 | evidence | All runs are runner-attested, with a red run before green for each AC. One AC-LB-5 verify failed before passing; output tails are truncated. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | The diff ends by removing the park registration in packages/lore/src/adapters/cli/index.ts and the parked schema in packages/core/src/schemas.ts. The plan's `lore park` verb (exit code 2 when --reason is missing) may not be reachable. |
| evidence_integrity | minor | AC-LB-5 | The AC-LB-5 verify command failed once on a config validation error before a later pass. Flakiness is possible. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Check the final tree for the park command registration, the schema field and the dedicated key after both parallel tasks merge. | Parallel tasks sharing a file appear to have reverted each other's park changes. |
| spec | Add an AC that exercises `lore park` directly: exit code 2 when --reason is missing, the park releases a branch hold, and a claim unparks. | AC-LB-2 as written tests only the holder and age message, so it cannot catch a missing park verb. |

## Unverifiable Materials

- final state of packages/lore/src/adapters/cli/index.ts and schemas.ts: The diff interleaves add and revert hunks; the final tree is not shown.
- omitted test files (lb-park, lb-claim-from-main, lb-definition-of-done): Truncated, so I could not confirm the asserted cases (3 subcases, equality unit test).
- lore done refusal message text: I could not confirm it names the exact `lore evidence` command required by AC-LB-4.
- scope_fidelity dimension score: based_on="absence" cited no matching unverifiable[]/judgment.truncated[] entry — suppressed as ungrounded rather than published as a finding.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] Claim-unparks (BR-1354) was added to packages/lore/src/service/task-workflow-service.ts and then reverted. Claiming a parked task no longer visibly deletes extra.parked. — "packages/lore/src/service/task-workflow-service.ts" was never shown to the judge (omitted from the truncated diff)

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
