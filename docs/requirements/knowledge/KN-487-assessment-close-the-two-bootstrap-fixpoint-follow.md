---
id: KN-487
type: knowledge
role: knowledge
title: "Assessment: Close the two bootstrap-fixpoint follow-ups: one anchored predicate in production, and a fixture-forced red for the anchor-value assertion (2026-08-21)"
status: approved
priority: medium
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-133
links:
  - {id: PLAN-133, type: informs}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01M0H3P61DHA1W1AS6KG4HBWFX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BFI-1 | 30 | No evidence rows for this AC in this bundle (0 pass/0 fail). Not in this plan's task scope; carried from earlier work but unverifiable here. | — |
| AC-BFI-2 | 30 | 0 pass / 0 fail in the deterministic coverage table. Nothing in the diff or evidence touches the provenance three-state check. | — |
| AC-BFI-3 | 30 | 0 pass / 0 fail. hooks/pre-push and assets/project/pre-push are absent from the diff; parity/wiring unverifiable from these materials. | — |
| AC-BFI-4 | 35 | 0 pass / 0 fail. The diff does touch its enumerator seam (collectCodeAnchorSpecMembers in commands/status.ts) but no oracle run re-confirms the count==members contract after that edit. | 01M0H3QEE5X18K9ZV8RE9X1W3A (status.ts enumerator refactored, no AC-BFI-4 re-run) |
| AC-BFI-5 | 30 | 0 pass / 0 fail. Ledger checker file was edited (isSpecAnchored import) but no ledger-checker oracle run is recorded here. | — |
| AC-BFI-6 | 30 | 0 pass / 0 fail. Its test file was heavily modified by this plan, yet only the -t anchored-predicate-ssot filtered subset is evidenced; the ratchet cases themselves show no run. | — |
| AC-BFI-7 | 30 | 0 pass / 0 fail. No stale-exemption oracle run in this bundle. | — |
| AC-BFI-8 | 30 | 0 pass / 0 fail. Mirror content-drift oracle untouched and unrun here. | — |
| AC-BFI-9 | 30 | 0 pass / 0 fail. Pre-push wiring for the anchor checker is not shown or re-verified in this diff. | — |
| AC-BFI-10 | 40 | 0 pass / 0 fail. The witness's loop body was refactored into classifyExtraAsAnchoredByWitness by this plan — a change directly inside AC-BFI-10's oracle — with no AC-BFI-10 run recorded to confirm it stayed green. | 01M0H3QEE5X18K9ZV8RE9X1W3A (witness loop body extracted) |
| AC-BFI-11 | 45 | 0 pass / 0 fail for this AC id, but its file (pre-push-trip.bun.test.ts) was extended and the full-file unfiltered run in task 743 evidence [2] shows AC-BFI-3-labelled cases passing, indirect support only. | 01M0H3R8HJPEQBYDD0EM2NFVJ1 (full-file bun test pass tail) |
| AC-BFI-12 | 30 | 0 pass / 0 fail. Referenced as lineage/discipline in comments only; no oracle run. | — |
| AC-BFI-13 | 45 | 0 pass / 0 fail directly. AC-BFI-15's fixture proves the assertion SHAPE can discriminate, but on a fixture spec, not AC-BFI-13's own case (d) against this repo's corpus — the transfer is argued, not measured. | 01M0H3R8HJPEQBYDD0EM2NFVJ1 |
| AC-BFI-14 | 86 | 1 attested pass. Both halves delivered: three production copies collapsed onto flows/drift-flow.ts::isSpecAnchored, structural comment-stripping scan asserts a single site, five-row differential table binds the witness. Both declared reds run. Gap: scan skips tests dirs by design and RED-b flipped … | 01M0H3QEE5X18K9ZV8RE9X1W3A (evidence [1] RED-a scan fires on synthetic 2nd copy; [2] RED-b differential disagreement; [3] attested pass) |
| AC-BFI-15 | 82 | 1 attested pass. Throwaway mkdtemp corpus owns two specs and two real files; DIST_BINARY used; drift exits exactly 0 while the shared assertion path throws naming ANCHOR_FILE_B. Declared red (repoint step deleted) was run. Gap: the RED asserts .toThrow, not an exact process exit code. | 01M0H3R8HJPEQBYDD0EM2NFVJ1 (evidence [1] declared red, [2] attested full-file pass) |

## Gaps

- This plan refactored AC-BFI-10's independent witness — extracting the loop body into classifyExtraAsAnchoredByWitness in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts — but no AC-BFI-10 evidence row exists (0 pass / 0 fail). A change inside a witness landed without the witness's own criterion being re-measured.
- packages/lore/src/adapters/cli/commands/status.ts::collectCodeAnchorSpecMembers is AC-BFI-4's published enumerator seam and was rewritten to import isSpecAnchored, yet AC-BFI-4 shows 0 pass / 0 fail. The count==len(members) contract was not re-verified after the edit.
- The Half-1 scan's collectExecutableSourceFiles in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts skips tests/test directories and *.test.ts files, so a fourth construction of the predicate landing in any test file cannot go red — narrower than the AC's 'repo-wide over packages/** and scripts/**' wording.
- The RED case in packages/lore/tests/integration/pre-push-trip.bun.test.ts asserts .toThrow on an in-process helper; the only exact-exit-code assertions are checkDriftExitCode == 0. The plan's 'exit code EXACTLY, never non-zero' rule is therefore satisfied only for the drift-clean half.
- Task 744's evidence [4] attested-red row failed with 'Could not resolve vitest/config' / 'Cannot find package vitest' in the harness worktree, and task 743's evidence [3] with 'Cannot find module @lore/core'. Those rows show a broken environment, not an oracle discriminating a mutation, so they add no discriminating power beyond the implementer-run reds.
- The AC-BFI-14 pass command is filtered (-t anchored-predicate-ssot) inside a file that also hosts AC-BFI-6/7/10 cases and was substantially edited. The one unfiltered run of packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts is recorded with ac_ref=(none), so no criterion owns the whole-file green.

## Recommendations

- Require that any AC whose oracle or subject file appears in the diff gets a recorded run before the plan archives, even when it is not the plan's own AC — a touched-oracle regression list derived mechanically from the diff.
- Widen the anchored-predicate uniqueness scan to include test files with an explicit two-entry allowlist (the witness copy and the differential table), instead of excluding all test directories.
- Treat an attested-red row whose output shows module-resolution or startup failure as inconclusive, not as a red — the harness should refuse to attest when the mutated assertion never executed.
- Capture as knowledge: (a) the undocumented third predicate copy that AC-BFI-14's scan found, (b) the attested-red harness failing before reaching the mutation.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 153051ms
- Retried: true
- Truncated sections: spec, task:task-collapse-the-two-production-copies-of-the-anchored, task:task-force-ac-bfi-13-s-red-inside-a-throwaway-corpus-that-owns
- Reasoning clipped for: AC-BFI-14
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.72 | evidence | Both in-plan ACs (14, 15) delivered and attested with real reds. The other 13 declared ACs are unevidenced here, and touched-oracle ACs were not re-run. |
| evidence_integrity | 58 | 0.7 | evidence | 2 attested passes plus run reds are genuine; but half the rows are self-typed, one pass has no ac_ref, and two attested-red rows failed on module resolution not the mutation. |
| scope_fidelity | 84 | 0.75 | evidence | Diff matches the two task anchors; the third predicate copy collapse is documented as a measured discovery, not silent drift. No lore ac set, per the orchestrator rule. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BFI-10 | This plan refactored AC-BFI-10's independent witness — extracting the loop body into classifyExtraAsAnchoredByWitness in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts — but no AC-BFI-10 evidence row exists (0 pass / 0 fail). A change inside a witness landed without the witness's own criterion being re-measured. |
| evidence_integrity | major | AC-BFI-4 | packages/lore/src/adapters/cli/commands/status.ts::collectCodeAnchorSpecMembers is AC-BFI-4's published enumerator seam and was rewritten to import isSpecAnchored, yet AC-BFI-4 shows 0 pass / 0 fail. The count==len(members) contract was not re-verified after the edit. |
| outcome | minor | AC-BFI-14 | The Half-1 scan's collectExecutableSourceFiles in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts skips tests/test directories and *.test.ts files, so a fourth construction of the predicate landing in any test file cannot go red — narrower than the AC's 'repo-wide over packages/** and scripts/**' wording. |
| outcome | minor | AC-BFI-15 | The RED case in packages/lore/tests/integration/pre-push-trip.bun.test.ts asserts .toThrow on an in-process helper; the only exact-exit-code assertions are checkDriftExitCode == 0. The plan's 'exit code EXACTLY, never non-zero' rule is therefore satisfied only for the drift-clean half. |
| evidence_integrity | minor | AC-BFI-14 | Task 744's evidence [4] attested-red row failed with 'Could not resolve vitest/config' / 'Cannot find package vitest' in the harness worktree, and task 743's evidence [3] with 'Cannot find module @lore/core'. Those rows show a broken environment, not an oracle discriminating a mutation, so they add no discriminating power beyond the implementer-run reds. |
| scope_fidelity | minor | AC-BFI-6 | The AC-BFI-14 pass command is filtered (-t anchored-predicate-ssot) inside a file that also hosts AC-BFI-6/7/10 cases and was substantially edited. The one unfiltered run of packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts is recorded with ac_ref=(none), so no criterion owns the whole-file green. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that any AC whose oracle or subject file appears in the diff gets a recorded run before the plan archives, even when it is not the plan's own AC — a touched-oracle regression list derived mechanically from the diff. | This plan edited the oracles of AC-BFI-4/5/6/7/10 and none were re-measured. |
| plan | Widen the anchored-predicate uniqueness scan to include test files with an explicit two-entry allowlist (the witness copy and the differential table), instead of excluding all test directories. | Test-file exclusion leaves a whole tree where a fourth copy is invisible to the scan. |
| process | Treat an attested-red row whose output shows module-resolution or startup failure as inconclusive, not as a red — the harness should refuse to attest when the mutated assertion never executed. | Two rows here failed on missing vitest/@lore/core, giving zero discriminating power. |
| spec | Capture as knowledge: (a) the undocumented third predicate copy that AC-BFI-14's scan found, (b) the attested-red harness failing before reaching the mutation. | 0 knowledge docs linked despite two durable, measured findings. |

## Unverifiable Materials

- hooks/pre-push and assets/project/pre-push: Not present in the diff; AC-BFI-3/AC-BFI-9 byte-identity and wiring claims cannot be checked from these materials.
- Oracle runs for AC-BFI-1 through AC-BFI-13: Coverage table reports 0 pass / 0 fail for each; no evidence rows in this bundle.
- scripts/check-anchor-coverage.ts runtime behavior post-refactor: File edited to import the shared predicate, but no checker execution recorded in this bundle.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 15 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.50
