---
id: KN-503
type: knowledge
role: knowledge
title: "Assessment: Make a falsifier's scratch worktree runnable and observable: hybrid dependency materialization, wired and falsified end to end (2026-08-23)"
status: archived
priority: medium
created: 2026-08-23
updated: 2026-10-23
tags: []
parent: PLAN-135
links:
  - {id: PLAN-135, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M0P67QXNECZM4HFP3QG1F35T`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SD-1 | 80 | Visible test file shows all five lettered clauses plus RED(i)-(iv) pinned; enumerated scope entries and nested-tree realpath checks present. Deducted: RED(iii)/(iv) are simulations that delete/replace the link the materializer just made rather than exercising materializer behaviour, and (e) relies … | 01M0P68VM0QN12DYMW7YNQ54PT (expected-fail then pass for 'hybrid layout'), 01M0P6A0RQHTHDPASPVRXEVDYY (attested expected-fail via falsify) |
| AC-SD-2 | 85 | deriveWorkspaceMembers reads root package.json workspaces globs and each member's own name — no hand-listed array. Fixture adds a fourth package with no code change and gets a scratch-internal redirect. RED is a comparison against a literal array in the test, not a real code swap, so slightly weake… | 01M0P68VM0QN12DYMW7YNQ54PT, 01M0PEBZ8Q9EVZ79AYJ5Y0HZN0 (stray-directory existsSync fix plus RED probe) |
| AC-SD-3 | 85 | HAPPY asserts control exit exactly 0 then mutated exit exactly 1 with the scratch path in output; RED(i) pins the ln -s layout staying wrongly green and RED(ii) pins the unmaterialized harness failing the control. Task notes one vacuous isInside assertion left unfixed. | 01M0P68VM0QN12DYMW7YNQ54PT, 01M0P6A0RQHTHDPASPVRXEVDYY |
| AC-SD-4 | 80 | Digest derived from git ls-files -z, porcelain empty, and readlink map over the enumerated scope dir, all compared across a full cycle. RED(i)/(iii) are simulated in-test rather than by perturbing the materializer, so they prove the detector, not the implementation. | 01M0P68VM0QN12DYMW7YNQ54PT, 01M0P6A0RQHTHDPASPVRXEVDYY |
| AC-SD-5 | 72 | Both-runner test and both per-runner REDs are evidenced as red-then-green, with the .bin half traceable to the code (dotted entries not filtered). Test body is not in the shown diff, so the exact summary-line assertions ('Test Files  1 passed', '0 fail') are unverifiable here. | 01M0P69FR9G4W04Q067DM672X6 (RED(i) .bin, RED(ii) bun without materialization, then pass) |
| AC-SD-6 | 78 | Wiring is visible in verify-runner-service.ts step 3.5 before the green control, and both REDs (materialization reverted; persistence skipped) were recorded red then green. The integration test body is omitted, so read-back-from-corpus and exit_code===1 assertions are taken on evidence alone. | 01M0P69FE1M6S2GAPS70AX8AHM (RED(i)/(ii) then pass) |
| AC-SD-7 | 75 | Both REDs recorded (greenUsable hardcoded true; materializer widened to stage untracked files) then green, and the code appends rather than substitutes the materialize note so the inconclusive branch stays intact. Describe body not shown. | 01M0P69FE1M6S2GAPS70AX8AHM |
| AC-SD-8 | 74 | Sentinel-survives and scratch-parent-gone halves both evidenced, with RED(i) symlink-following delete and RED(ii) no-op cleanup each recorded red. Cleanup implementation and test body are not in the shown diff, so the no-follow guarantee is unverified at the code level. | 01M0P69FR9G4W04Q067DM672X6 |

## Gaps

- AC-SD-1 RED(iii)/(iv) and AC-SD-4 RED(i)/(iii) are pinned as in-test simulations in packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts: they call the real materializer then delete/replace the nested link, or mutate the main tree and repoint a scope link by hand. Each proves the assertion can detect the defect, not that the materializer avoids it — a materializer that stopped creating nested links would still leave these tests green.
- The cleanup implementation backing AC-SD-8 is not present in the shown diff for packages/lore/src/service/verify-runner-service.ts, so the symlink-no-follow delete is evidenced only by test outcomes, not by reviewable code.
- A known-vacuous assertion remains in the mutation-observability test: isInside(mutatedCorePath, scratch.worktreeDir) where mutatedCorePath was constructed by joining onto scratch.worktreeDir, so it is always true and carries no information.
- AC-SD-1(e)'s enumeration is exercised against a fixture with exactly one nested node_modules (packages/extra), so a bug that links only the first discovered nested tree would not be caught in packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts.

## Recommendations

- Require that a criterion's RED direction be produced by perturbing production code (or a fixture the production code reads), not by post-hoc mutation of the artifact the production code just produced.
- Add a second nested per-package node_modules to the fixture repo so AC-SD-1(e)'s enumeration loop covers more than one member.
- Include the cleanup path implementation and the negative-control script in the reviewable surface for AC-SD-8 and the P4 control.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 160337ms
- Retried: true
- Truncated sections: spec, diff:packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts, diff:packages/lore/tests/integration/cli/verify-falsify-dep-materialization.test.ts, diff:packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts, diff:packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts, diff:scripts/falsifier-negative-control.ts
- Reasoning clipped for: AC-SD-1, AC-SD-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.72 | evidence | All eight ACs have red-then-green trails; production wiring visible in verify-runner-service.ts step 3.5 and derivation is genuinely runtime, not hand-listed. |
| evidence_integrity | 72 | 0.7 | evidence | Every AC has attested reds, but ratio 0.33 and several REDs are in-test simulations rather than perturbations of production code; negative control script unseen. |
| scope_fidelity | 88 | 0.75 | evidence | Phase boundaries respected: P1 module avoids verify-runner-service.ts, wiring lands in P3 with its own oracle, and the untracked-file scope guard is explicitly kept out. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-SD-1 | AC-SD-1 RED(iii)/(iv) and AC-SD-4 RED(i)/(iii) are pinned as in-test simulations in packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts: they call the real materializer then delete/replace the nested link, or mutate the main tree and repoint a scope link by hand. Each proves the assertion can detect the defect, not that the materializer avoids it — a materializer that stopped creating nested links would still leave these tests green. |
| evidence_integrity | minor | AC-SD-8 | The cleanup implementation backing AC-SD-8 is not present in the shown diff for packages/lore/src/service/verify-runner-service.ts, so the symlink-no-follow delete is evidenced only by test outcomes, not by reviewable code. |
| outcome | minor | AC-SD-3 | A known-vacuous assertion remains in the mutation-observability test: isInside(mutatedCorePath, scratch.worktreeDir) where mutatedCorePath was constructed by joining onto scratch.worktreeDir, so it is always true and carries no information. |
| outcome | minor | AC-SD-1 | AC-SD-1(e)'s enumeration is exercised against a fixture with exactly one nested node_modules (packages/extra), so a bug that links only the first discovered nested tree would not be caught in packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that a criterion's RED direction be produced by perturbing production code (or a fixture the production code reads), not by post-hoc mutation of the artifact the production code just produced. | Simulation REDs verify the assertion, not the implementation, which is the same discriminating-power defect this spec exists to close. |
| plan | Add a second nested per-package node_modules to the fixture repo so AC-SD-1(e)'s enumeration loop covers more than one member. | A single nested tree cannot distinguish 'links every discovered tree' from 'links the first one'. |
| plan | Include the cleanup path implementation and the negative-control script in the reviewable surface for AC-SD-8 and the P4 control. | Both are load-bearing safety properties currently evidenced only by test outcomes. |

## Unverifiable Materials

- packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts (later revisions covering AC-SD-5, AC-SD-7, AC-SD-8 describes): Omitted from the diff per the truncation manifest; only the P1 revision is shown, so the both-runners, green-control, and cleanup assertions cannot be read.
- packages/lore/tests/integration/cli/verify-falsify-dep-materialization.test.ts: Omitted from the diff; AC-SD-6's read-back-from-throwaway-corpus and exit_code===1 assertions are known only from evidence rows.
- scripts/falsifier-negative-control.ts: Omitted from the diff; the exit-4 refusal assertion and paired positive control cannot be inspected.
- removeFalsifierScratchWorktree cleanup implementation: Not included in the shown verify-runner-service.ts hunks; the symlink-no-follow delete cannot be verified at code level.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.33
