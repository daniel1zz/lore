---
id: KN-502
type: knowledge
role: knowledge
title: "Assessment: Make a falsifier's scratch worktree runnable and observable: hybrid dependency materialization, wired and falsified end to end (2026-08-23)"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
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
| AC-SD-1 | 87 | Diff shows real node_modules + real scope dir, dotted entries kept, nested links; test enumerates scope entries, checks vitest realpath outside, and compares linkedNested to an enumerated packages/*/node_modules set. 2 passes, 1 attested. RED(i) pinned test compares against the non-realpath scratch… | 01M0P68VM0QN12DYMW7YNQ54PT (P1 expected-fail [1] then pass [5]/[12]), 01M0P6A0RQHTHDPASPVRXEVDYY (AC-SD-1 falsify row) |
| AC-SD-2 | 90 | deriveWorkspaceMembers reads root package.json workspaces globs + each member's own name at call time; test adds a fourth fixture package with no code change and asserts a scratch-internal redirect. RED (hand-listed array) evidenced red then green. | 01M0P68VM0QN12DYMW7YNQ54PT (expected-fail [3], pass [6]/[13]) |
| AC-SD-3 | 88 | Test asserts control exit exactly 0 then mutated exit exactly 1 with the scratch absolute path in output; both RED directions present (plain ln -s stays green; skipped materialization fails the control). Attested pass recorded. Load-bearing criterion genuinely exercised. | 01M0P68VM0QN12DYMW7YNQ54PT (expected-fail [2], pass [7]/[14]) |
| AC-SD-4 | 85 | Digest derived from git ls-files -z, porcelain check, and readlink map over the enumerated scope dir; falsify row [4] shows a real red ('?? PROBE_LEAK'). RED ii/iii are simulations that never invoke the materializer, so they pin the oracle rather than the implementation. | 01M0P68VM0QN12DYMW7YNQ54PT (expected-fail [4], pass [8]/[15]) |
| AC-SD-5 | 82 | Evidence shows 'both runners' HAPPY plus RED(i) (.bin omitted breaks vitest) green, and RED(ii) probed red before implementation. Test body not shown in diff, so the bun-half summary-line assertions and its control are judged from tails only. | 01M0P69FE1M6S2GAPS70AX8AHM (expected-fail [1][2], pass [10]/[12]) |
| AC-SD-6 | 84 | Wiring visible in verify-runner-service.ts before the green control; integration test evidenced red under both REDs (materialization reverted → green-control failure; persistence stubbed → row undefined) then green twice. Test file itself unseen, so read-back-from-corpus and exit_code==1 rest on ta… | 01M0P69FR9G4W04Q067DM672X6 (expected-fail [1][2], pass [5]/[8]) |
| AC-SD-7 | 85 | 3 passes, 1 attested; both REDs evidenced (greenUsable hardcoded true; materializer widened to stage untracked files). Wiring comments and the append-never-substitute annotation are consistent with the control still firing. | 01M0P69FR9G4W04Q067DM672X6 (expected-fail [3][4], pass [6]/[9]) |
| AC-SD-8 | 80 | Sentinel-survives + scratch-parent-gone evidenced green (3 tests) with both REDs probed red. No cleanup change appears in the shown verify-runner-service.ts diff, so the property may rest on pre-existing rmSync behavior rather than a deliberate guard — acceptable but unverified here. | 01M0P69FE1M6S2GAPS70AX8AHM (expected-fail [3][4], pass [11]/[13]) |

## Gaps

- The plan marks a NEGATIVE control mandatory for P4: declare one throwaway criterion whose falsifier mutation is deliberately inert and show lore verify --falsify refuses it rather than recording a red. The P4 task text lists no such step and its evidence contains only the eight expected-fail rows plus an anchor-coverage pass. Without it, 'all eight produced an attested red' cannot be distinguished from a falsifier that now says yes to everything — the exact circularity the plan called out.
- In packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts the RED(i) plain-symlink trap calls findEscapingScopeEntries(..., scratch.worktreeDir) with the un-resolved handle, while the HAPPY test documents that /var vs /private/var makes that comparison always report 'outside'. The trap therefore asserts a result it would also get from a correct hybrid layout.
- packages/lore/src/service/falsifier-dep-materialization.ts derives nested node_modules links from the workspace-member list, and deriveWorkspaceMembers fails loud on any directory under packages/ lacking a package.json with a scoped name. A real-repo directory holding a nested node_modules but no valid scoped package.json is either skipped from nested linking or aborts materialization, whereas AC-SD-1(e) frames the discovery as enumerating packages/*/node_modules.
- The shown packages/lore/src/service/verify-runner-service.ts diff changes only the materialization wiring and annotations; no cleanup-path change is visible, so AC-SD-8's symlink-escape property appears to rely on pre-existing removeFalsifierScratchWorktree behavior that the diff does not expose.

## Recommendations

- Reopen P4 (or add a follow-up task) to declare one throwaway criterion with an inert falsifier mutation, drive lore verify --falsify over it, and record that the run refuses it rather than recording expected-fail.
- Require that 'permanently pinned' RED traps reuse the same normalization (realpath) as the HAPPY assertion they mirror, and add a self-check that the trap fails when handed a correct layout.
- State explicitly which root the materializer must be given when opts.executionRoot differs from config.repoRoot, and cover that case with a test.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 106377ms
- Retried: false
- Truncated sections: spec, diff:packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts, diff:packages/lore/tests/integration/cli/verify-falsify-dep-materialization.test.ts, diff:packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts
- Reasoning clipped for: AC-SD-1, AC-SD-6

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.7 | evidence | Module, unit oracles, both-runner/cleanup coverage and live _runFalsifier wiring all present; every AC has 2+ passes incl. one attested, with REDs evidenced per criterion. |
| evidence_integrity | 70 | 0.6 | evidence | Reds and greens recorded per AC, but the plan's mandatory inert-mutation negative control is missing and one pinned trap is vacuous on macOS, weakening discriminating-power claims. |
| scope_fidelity | 80 | 0.6 | evidence | Phase boundaries respected (wiring only in P3, cleanup-only touch in P2); drift is an omission — P4's required negative control — not an expansion. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-SD-6 | The plan marks a NEGATIVE control mandatory for P4: declare one throwaway criterion whose falsifier mutation is deliberately inert and show lore verify --falsify refuses it rather than recording a red. The P4 task text lists no such step and its evidence contains only the eight expected-fail rows plus an anchor-coverage pass. Without it, 'all eight produced an attested red' cannot be distinguished from a falsifier that now says yes to everything — the exact circularity the plan called out. |
| evidence_integrity | minor | AC-SD-1 | In packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts the RED(i) plain-symlink trap calls findEscapingScopeEntries(..., scratch.worktreeDir) with the un-resolved handle, while the HAPPY test documents that /var vs /private/var makes that comparison always report 'outside'. The trap therefore asserts a result it would also get from a correct hybrid layout. |
| outcome | minor | AC-SD-1 | packages/lore/src/service/falsifier-dep-materialization.ts derives nested node_modules links from the workspace-member list, and deriveWorkspaceMembers fails loud on any directory under packages/ lacking a package.json with a scoped name. A real-repo directory holding a nested node_modules but no valid scoped package.json is either skipped from nested linking or aborts materialization, whereas AC-SD-1(e) frames the discovery as enumerating packages/*/node_modules. |
| outcome | minor | AC-SD-8 | The shown packages/lore/src/service/verify-runner-service.ts diff changes only the materialization wiring and annotations; no cleanup-path change is visible, so AC-SD-8's symlink-escape property appears to rely on pre-existing removeFalsifierScratchWorktree behavior that the diff does not expose. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Reopen P4 (or add a follow-up task) to declare one throwaway criterion with an inert falsifier mutation, drive lore verify --falsify over it, and record that the run refuses it rather than recording expected-fail. | The plan itself declares this control mandatory; without it the eight attested reds have no demonstrated discriminating power. |
| process | Require that 'permanently pinned' RED traps reuse the same normalization (realpath) as the HAPPY assertion they mirror, and add a self-check that the trap fails when handed a correct layout. | A trap that passes under both correct and rejected layouts protects nothing while reading as coverage. |
| plan | State explicitly which root the materializer must be given when opts.executionRoot differs from config.repoRoot, and cover that case with a test. | Sourcing dependencies/workspace derivation from a different root than the scratch worktree's origin could reintroduce cross-tree resolution. |

## Unverifiable Materials

- packages/lore/tests/integration/cli/verify-falsify-dep-materialization.test.ts contents: Omitted per truncation manifest; AC-SD-6's read-back-from-throwaway-corpus and exit_code==1 assertions judged from evidence tails only.
- Current full contents of the unit test file (24 tests, incl. 'both runners', 'green control still fires', 'cleanup cannot escape'): Diff shows only the 16-test P1 version; AC-SD-5/7/8 assertion bodies not inspectable.
- Binding of `repoRoot` at the materializeFalsifierDependencies call site in verify-runner-service.ts: Diff context does not show whether it equals the resolved executionRoot used to create the scratch worktree.
- Post-declaration `lore review` + `lore approve` re-run required by P4 step 3: No evidence row or oracle output for the approval step appears in the bundle.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.35
