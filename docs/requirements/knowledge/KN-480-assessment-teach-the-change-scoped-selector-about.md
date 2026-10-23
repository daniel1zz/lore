---
id: KN-480
type: knowledge
role: knowledge
title: "Assessment: Teach the change-scoped selector about hooks/ and assets/, so a hook edit can no longer silence the two tests that prove pre-push is wired (2026-08-20)"
status: archived
priority: medium
created: 2026-08-20
updated: 2026-10-23
tags: []
parent: PLAN-130
links:
  - {id: PLAN-130, type: informs}
---
# Assessment: partially_met (77/100)

Scope: plan `01M0AMKKMR8WNVAXYNK1B27TV8`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TC-1 | 68 | No evidence record tagged AC-TC-1 (0 pass/0 fail). Mitigation: the exact command ran green in task-2 evidence [7] (ac_ref=none) and in AC-TC-5 evidence [5]/[7] showing 63 selector tests passing, and the diff extends that suite. Attribution, not capability, is the gap. | 01M0AMM60446Y7AW0QCQRDGVTP (evidence [7] selector suite pass, ac_ref=(none)), 01M0CH5S5R4WCHH8RJMH2X1S8V (evidence [5]/[7]: 63 selector tests pass) |
| AC-TC-2 | 65 | 0 evidence records tagged AC-TC-2. Mitigation: AC-TC-4/AC-TC-6 pass tails show the 'bun run test:changed CLI — --list HEAD (AC-TC-2)' cases passing (selected-count line for both runners, real reason tag). Never run/attested under its own declared e2e command. | 01M0AMM60446Y7AW0QCQRDGVTP (evidence [4]/[5] tails include AC-TC-2 describe passes), 01M0CH5S5R4WCHH8RJMH2X1S8V (evidence [8] tail includes AC-TC-2 passes) |
| AC-TC-3 | 58 | One `bun run typecheck` pass exists but ac_ref=(none) and it predates the later task that changed classifyTreeScanningOracle's return type to ReadonlySet<TreeScanScope> and its callers. No typecheck run after that signature change, so AC-TC-3 is stale as well as untagged. | 01M0AMM60446Y7AW0QCQRDGVTP (evidence [6] oracle=tsc pass, ac_ref=(none)) |
| AC-TC-4 | 92 | 2 attested passes plus three expected-fail baselines: pre-fix, site-1-reverted, site-2-reverted — each naming the omitted guard, satisfying the 'neither alone sufficient' RED. Oracle drives `bun scripts/changed-tests.ts --list` via subprocess against a temp git repo, and asserts the (tree-scan-orac… | 01M0AMM60446Y7AW0QCQRDGVTP (evidence [1]-[3] expected-fail, [4]-[5] pass (2 attested)) |
| AC-TC-5 | 86 | Diff makes classification return a Set and selection fire on ANY member; the six real multi-scope files are read from disk with expected-vs-got reporting. RED via restored early return is evidenced. Deduction: 2 pass but only 1 attested, and one earlier run was inconclusive (chained two runners). | 01M0CH5S5R4WCHH8RJMH2X1S8V (evidence [1]/[3] expected-fail; [7] pass attested; [6] inconclusive) |
| AC-TC-6 | 84 | 1 attested pass; regex exported and both real guard files read from disk with regex match plus classifier output pinned. Declared falsifier (regex neutralized to NEVERMATCH) evidenced reddening selector + CLI cases. Minor: the pinning describe block is titled AC-TC-5, weakening traceability. | 01M0CH5S5R4WCHH8RJMH2X1S8V (evidence [8] pass attested; [4] falsifier expected-fail) |

## Gaps

- The single typecheck pass is tagged ac_ref=(none) and was recorded by the earlier task, before classifyTreeScanningOracle in scripts/changed-tests.ts changed its return type to ReadonlySet<TreeScanScope> and before packages/lore/tests/unit/scripts/changed-tests-selector.test.ts and packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts restated that type locally. No typecheck evidence covers the final code state.
- AC-TC-1 and AC-TC-2 carry 0 pass / 0 fail records. Their commands did run green (untagged selector run; AC-TC-2 describe cases visible inside AC-TC-4/AC-TC-6 tails), so the defect is attribution rather than capability, but neither AC is independently attestable from this bundle.
- The marker in scripts/changed-tests.ts fires on any test file that merely mentions hooks/pre-push or assets/project/pre-push in prose, so six governance suites are now selected for every hooks/** or assets/** change. Documented and safe-direction, but the membership signal cannot distinguish a prose mention from a file that actually drives the hook pair.
- The real-file pinning cases added to packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts sit in a describe block titled 'AC-TC-5: the hooks/assets marker is pinned...' even though AC-TC-6 is the criterion they satisfy, so title-based coverage tracing points at the wrong AC.

## Recommendations

- Before archiving a task, re-run every AC in the plan's scope under its declared command with an explicit ac_ref, including typecheck, rather than relying on untagged incidental runs.
- Add a final verification task that re-runs AC-TC-1, AC-TC-2 and AC-TC-3 after the last code-touching task, since AC-TC-5's signature change invalidated the earlier typecheck.
- Rename the pinning describe block to AC-TC-6 (and record the required title in the AC, as AC-TC-4 already does) so the split criterion's coverage is traceable by block title.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 86067ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-TC-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.72 | evidence | AC-TC-4/5/6 delivered with both code sites changed additively and pinned against real files; AC-TC-1/2/3 lack their own runs though the diff and tails suggest they hold. |
| evidence_integrity | 70 | 0.7 | evidence | Rich RED/GREEN trail for the hooks/assets work, but attested ratio 0.33, one inconclusive chained run, and three ACs with no tagged records at all. |
| scope_fidelity | 93 | 0.8 | evidence | Diff touches only the two declared code sites plus their two test suites; hooks/pre-push, assets/project/pre-push, attestation-completeness.ts and the marker-only approach untouched. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-TC-3 | The single typecheck pass is tagged ac_ref=(none) and was recorded by the earlier task, before classifyTreeScanningOracle in scripts/changed-tests.ts changed its return type to ReadonlySet<TreeScanScope> and before packages/lore/tests/unit/scripts/changed-tests-selector.test.ts and packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts restated that type locally. No typecheck evidence covers the final code state. |
| evidence_integrity | major | AC-TC-1 | AC-TC-1 and AC-TC-2 carry 0 pass / 0 fail records. Their commands did run green (untagged selector run; AC-TC-2 describe cases visible inside AC-TC-4/AC-TC-6 tails), so the defect is attribution rather than capability, but neither AC is independently attestable from this bundle. |
| outcome | minor | AC-TC-6 | The marker in scripts/changed-tests.ts fires on any test file that merely mentions hooks/pre-push or assets/project/pre-push in prose, so six governance suites are now selected for every hooks/** or assets/** change. Documented and safe-direction, but the membership signal cannot distinguish a prose mention from a file that actually drives the hook pair. |
| outcome | minor | AC-TC-6 | The real-file pinning cases added to packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts sit in a describe block titled 'AC-TC-5: the hooks/assets marker is pinned...' even though AC-TC-6 is the criterion they satisfy, so title-based coverage tracing points at the wrong AC. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Before archiving a task, re-run every AC in the plan's scope under its declared command with an explicit ac_ref, including typecheck, rather than relying on untagged incidental runs. | Three of six ACs have no tagged evidence and the typecheck evidence is stale relative to a return-type change. |
| plan | Add a final verification task that re-runs AC-TC-1, AC-TC-2 and AC-TC-3 after the last code-touching task, since AC-TC-5's signature change invalidated the earlier typecheck. | Sequential tasks in one plan can stale an earlier AC's oracle; nothing in the plan forces a re-run. |
| spec | Rename the pinning describe block to AC-TC-6 (and record the required title in the AC, as AC-TC-4 already does) so the split criterion's coverage is traceable by block title. | AC-TC-6's cases currently sit under an AC-TC-5 title, muddying the split the tooling constraint forced. |

## Unverifiable Materials

- Which specific evidence records are the attested ones (facts give counts only): Attested/self-reported split is reported per task as aggregate counts, so individual RED baselines cannot be confirmed as attested.
- Real content of packages/lore/tests/unit/assets/pre-push-parity.test.ts and packages/lore/tests/integration/pre-push-trip.bun.test.ts: Not included in the diff or materials; the pinning assertions' correctness rests on the reported run results alone.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.33
