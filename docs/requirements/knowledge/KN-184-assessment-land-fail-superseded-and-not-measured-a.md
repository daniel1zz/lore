---
id: KN-184
type: knowledge
role: knowledge
title: "Assessment: Land fail_superseded and not_measured as one widening of the coverage derivation, absorbing the consumer ripple exactly once (2026-08-07)"
status: archived
priority: medium
created: 2026-08-07
updated: 2026-10-23
tags: []
parent: PLAN-080
links:
  - {id: PLAN-080, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KZE4BGAQ4EAX14KMYF7TV9QD`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-FALS-1 | 62 | No ac_ref'd run in this bundle. Mitigated: unattributed evidence [37] runs the whole containing file (ac-falsifiability.test.ts, 16 tests) green, and the diff shows the M1 tests intact. Declared -t invocation itself never re-run here. | 01KZE4DP2RCRG7C1SNTC0Q36ZS (evidence [37] whole-file green, ac_ref=(none)) |
| AC-FALS-2 | 62 | Prior-slice criterion; no ac_ref'd run. Whole-file green in [37] and the pass_unfalsified branch is visibly preserved in the widened derivation (rank 5). Declared -t oracle not re-executed under this plan. | 01KZE4DP2RCRG7C1SNTC0Q36ZS (evidence [37]) |
| AC-FALS-3 | 65 | attested_pass precedence explicitly re-proved as a side effect: AC-FALS-23's live-corpus oracle asserts AC-FALS-3 still reads attested_pass, and AC-FALS-14's test pins the same. No direct -t run of its own command. | 01KZE4DP2RCRG7C1SNTC0Q36ZS (evidence [20]/[36] AC-FALS-3=attested_pass) |
| AC-FALS-4 | 60 | No ac_ref'd run. Mitigated only by unattributed evidence [38] running the whole declared oracle file (ac-list-falsified.bun.test.ts) green. The json-surfacing pattern itself was not selected or shown. | 01KZE4DP2RCRG7C1SNTC0Q36ZS (evidence [38]) |
| AC-FALS-5 | 60 | Same as AC-FALS-4: whole-file green in [38], no ac_ref'd or -t-selected run. Human-render marker behaviour unchanged by this diff but not directly re-measured. | 01KZE4DP2RCRG7C1SNTC0Q36ZS (evidence [38]) |
| AC-FALS-6 | 58 | Whole-file green in [38] only. The plan required the corpus-wide pass_unfalsified count be verified by RUNNING status.ts; no status run appears in evidence, and the CLAUDE.md edit asserts the invariant in prose instead. | 01KZE4DP2RCRG7C1SNTC0Q36ZS (evidence [38]; no lore status run recorded) |
| AC-FALS-7 | 32 | Prior-slice criterion. Zero evidence rows in this bundle; evidence-pipe-refusal.bun.test.ts never run, and no diff touches the pipe-refusal path. Unverified here, not contradicted. | — |
| AC-FALS-8 | 30 | Zero evidence rows; unclaimed-oracle.test.ts never invoked in this slice and not in the diff. No mitigation offered anywhere in the plan or tasks. | — |
| AC-FALS-9 | 32 | Zero evidence rows; evidence-pipe-wiring.bun.test.ts never invoked. Exit-status-4 wiring untouched by this diff, but that is inference, not measurement. | — |
| AC-FALS-11 | 92 | bun run typecheck exit 0 recorded repeatedly across both phases ([21],[24],[9],[12]); 6 pass / 2 attested. Phase 2 additionally wired the dashboard tests project into the chain, so the gate is now strictly wider than before. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([21],[24]), 01KZE4XN8J38TF97R5M9GA5P9B ([2],[4],[9],[12]) |
| AC-FALS-12 | 80 | Enumerated invocation exits 0 ([25],[2],[3]). But the enumeration was measurably under-inclusive: ac-service.test.ts failed on merged main and the command was widened POST-HOC. Green now, oracle method proven leaky. | 01KZE8TVZ1D4PQEM4AG3YHCVJT (red [1] then green [2]/[3] after widening) |
| AC-FALS-13 | 78 | 3-file bun invocation exits 0 ([23],[26], 40 tests). Same frozen-file-list weakness as AC-FALS-12 and never re-validated by discovery after that method demonstrably failed once in this same slice. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([23],[26]) |
| AC-FALS-14 | 95 | Red [2] then green [11]/[27]. Test in diff asserts fail_superseded / fail / attested_pass from one recency ordering plus Set-size 3 distinctness — anti-vacuity is explicit, not implied. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([2] expected-fail → [11],[27] pass) |
| AC-FALS-15 | 95 | Red [3] → green [12]/[28]. Both fixtures built through computeAcCoverage (not hand-set) and falsified asserted as exact 1, with divergent states proving state moved while the count did not. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([3] → [12],[28]) |
| AC-FALS-16 | 94 | Red [4] → green [13]/[29]. All three tie-breaks (equal recorded_at, absent recorded_at on attested pass, unattested newer pass) asserted in one test, each yielding fail, matching the implementation's short-circuits. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([4] → [13],[29]) |
| AC-FALS-17 | 95 | Red [5] → green [14]/[30]. Six falsified inputs (undefined/null/NaN/-1/0/1) asserted individually plus Set size 3, matching isWellFormedFalsifiedCount's positive-test predicate. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([5] → [14],[30]) |
| AC-FALS-18 | 93 | Red [6] → green [15]/[31]. With falsified undefined, fail/attested_pass/none branches verified unchanged, matching the code where only the pass>0 branch consults the field. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([6] → [15],[31]) |
| AC-FALS-19 | 94 | Red [7] → green [16]/[32]. Badges ✘S(1/1) and ⚠(1/0) asserted exactly and checked against a list of pre-existing/residual shapes, closing the named if-chain fall-through hazard. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([7] → [16],[32]) |
| AC-FALS-20 | 88 | Red [8] → green [17]/[33]; three pairwise-distinct classNames asserted, and CoverageState is genuinely ReturnType<typeof deriveAcCoverageState> in the diff. Caveat: not_measured reuses 'destructive', visually identical to a real fail. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([8] → [17],[33]) |
| AC-FALS-21 | 93 | Red [9] → green [18]/[34]. typeof number asserted on the fixture itself, 'falsified' in obj === false on the deleted variant, and the two render different states — plus one pre-existing test was corrected as green-for-wrong-reason. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([9] → [18],[34]) |
| AC-FALS-22 | 89 | Red [10] (TS6059 noise) → green [19]/[35]. Test file omitted from the shown diff but attested green; the false-oracle diagnosis (inherited exclude) was corrected and the fixture-goes-red half is asserted in the same test. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([10] → [19],[35]) |
| AC-FALS-23 | 96 | Strongest row in the bundle: red [1] printed 'AC-FALS-11=fail … -> FAIL' on the real CLI read path, green [20]/[36] printed fail_superseded twice with AC-FALS-3 still attested_pass. Proves wiring, not just the core function. | 01KZE4DP2RCRG7C1SNTC0Q36ZS ([1] expected-fail → [20],[36] pass) |
| AC-FALS-24 | 90 | Red [1] then four green runs ([3],[5],[8],[13]) of the chain-covers-tests test, plus bun run typecheck exit 0 on the same commits. Phase-2 sweep evidence [6]/[11] shows the 18 fixture files re-run green. | 01KZE4XN8J38TF97R5M9GA5P9B ([1] expected-fail → [3],[5],[8],[13] pass) |

## Gaps

- AC-FALS-8 has no evidence row of any kind in this bundle; unclaimed-oracle.test.ts is neither run nor touched. The plan declares no ac_scope, so this criterion is formally in scope and simply unverified. AC-FALS-7 and AC-FALS-9 are in the same position.
- The plan explicitly required the corpus-wide pass_unfalsified count be verified 'by running it, not by reasoning about it'. No `lore status` invocation appears in any evidence row. The invariant survives only as prose in the cli/CLAUDE.md diff, whose '0 mismatches' phrasing also sits uneasily beside AC-FALS-23 measuring two criteria change state.
- AC-FALS-12/13 use frozen file enumerations as their whole oracle. That method demonstrably failed inside this very slice: ac-service.test.ts was outside the enumeration, went red on merged main, and the command was widened afterwards. AC-FALS-13's enumeration was never re-validated by discovery after that failure, so the same latent hole may remain there.
- not_measured and fail both map to the 'destructive' badge variant in stateVariant. AC-FALS-20 only requires distinction from fail_superseded and pass_unfalsified, so the criterion passes, but a fixture/bookkeeping defect is now rendered with the same alarm treatment as a genuine failing criterion — the CLI keeps them separate (⚠ vs ✘), the dashboard does not.
- Populating recorded_at on every EvidenceRefLite widens a consumer-visible JSON surface (refs[] in `lore ac list --json`). No declared criterion pins that change; it was found only through three stale exact-toEqual assertions, one of which escaped into a follow-up task.
- Two CLAUDE.md files were edited, one flagged at 14863/16384 bytes, yet no `--check-claude-md` or byte-ceiling oracle run is recorded. The ceiling appears respected by inspection of the diff, but that is inference, not measurement.

## Recommendations

- Replace AC-FALS-12/13's frozen file enumerations with a discovery-based oracle (glob or symbol query resolved at run time) so an under-inclusive authoring-time list can no longer pass green.
- Add an explicit evidence row for the pass_unfalsified count invariant (`lore status --json` before/after) and remove or scope-correct the '0 mismatches' sentence in packages/lore/src/adapters/cli/CLAUDE.md.
- Either narrow the plan's ac_scope to the M4/M5 criteria actually executed, or record runs for AC-FALS-1..10 on the landing commit.
- When a derivation widens a shared output row shape (e.g. recorded_at on EvidenceRefLite), require a criterion pinning the serialized surface, not just the in-memory type.
- Extend AC-FALS-20 to require not_measured be distinguishable from fail in the dashboard, or add a fifth badge variant.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 157915ms
- Retried: false
- Truncated sections: plan, task:task-clear-the-46-pre-existing-strictness-errors-the-un, task:task-widen-deriveaccoveragestate-to-seven-values-and-wire-every, diff:packages/dashboard/tests/unit/typecheck-scope.test.ts, diff:packages/dashboard/tsconfig.tests.json, diff:package.json, diff:packages/dashboard/tests/component/ConflictModal.test.tsx, diff:packages/dashboard/tests/component/DocDetail.delete.test.tsx, diff:packages/dashboard/tests/component/DocDetail.test.tsx, diff:packages/dashboard/tests/component/DocDetail.write.test.tsx, diff:packages/dashboard/tests/component/DocTree.test.tsx, diff:packages/dashboard/tests/component/EvidenceTab.test.tsx, diff:packages/dashboard/tests/component/ExecutionPage.test.tsx, diff:packages/dashboard/tests/component/HistoryTab.test.tsx, diff:packages/dashboard/tests/component/IssueDetail.test.tsx, diff:packages/dashboard/tests/component/LinksPanel.test.tsx, diff:packages/dashboard/tests/component/PlanExecution.test.tsx, diff:packages/dashboard/tests/component/ResolvedPrdBody.test.tsx, diff:packages/dashboard/tests/component/RootLayoutNav.test.tsx, diff:packages/dashboard/tests/component/SearchResultCard.test.tsx, diff:packages/dashboard/tests/component/TaskExecution.test.tsx, diff:packages/dashboard/tests/unit/lib/mutations.test.ts, diff:packages/dashboard/tests/unit/lib/review-queue.test.ts, diff:packages/dashboard/tests/unit/typecheck-scope.test.ts, diff:packages/dashboard/tsconfig.tests.json
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.82 | evidence | M4/M5 landed end-to-end: seven-state derivation, all six consumers, two SSOT unions derived not copied, and AC-FALS-23 proves the shipped read path. Prior-slice AC-FALS-7/8/9 unexercised. |
| evidence_integrity | 80 | 0.75 | evidence | Red-first expected-fail then pass for every new AC, 13 attested rows, false oracle self-corrected. Offset by leaky frozen-list oracles and an unmeasured, possibly contradicted CLAUDE.md count claim. |
| scope_fidelity | 88 | 0.75 | evidence | Edits track the declared anchors; phase-2 fixture sweep and tests/e2e exclusion were budgeted and their residual named. Post-hoc AC-FALS-12 command widening is disclosed drift, not concealed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-FALS-8 | AC-FALS-8 has no evidence row of any kind in this bundle; unclaimed-oracle.test.ts is neither run nor touched. The plan declares no ac_scope, so this criterion is formally in scope and simply unverified. AC-FALS-7 and AC-FALS-9 are in the same position. |
| evidence_integrity | major | AC-FALS-6 | The plan explicitly required the corpus-wide pass_unfalsified count be verified 'by running it, not by reasoning about it'. No `lore status` invocation appears in any evidence row. The invariant survives only as prose in the cli/CLAUDE.md diff, whose '0 mismatches' phrasing also sits uneasily beside AC-FALS-23 measuring two criteria change state. |
| evidence_integrity | major | AC-FALS-12 | AC-FALS-12/13 use frozen file enumerations as their whole oracle. That method demonstrably failed inside this very slice: ac-service.test.ts was outside the enumeration, went red on merged main, and the command was widened afterwards. AC-FALS-13's enumeration was never re-validated by discovery after that failure, so the same latent hole may remain there. |
| outcome | minor | AC-FALS-20 | not_measured and fail both map to the 'destructive' badge variant in stateVariant. AC-FALS-20 only requires distinction from fail_superseded and pass_unfalsified, so the criterion passes, but a fixture/bookkeeping defect is now rendered with the same alarm treatment as a genuine failing criterion — the CLI keeps them separate (⚠ vs ✘), the dashboard does not. |
| scope_fidelity | minor | AC-FALS-14 | Populating recorded_at on every EvidenceRefLite widens a consumer-visible JSON surface (refs[] in `lore ac list --json`). No declared criterion pins that change; it was found only through three stale exact-toEqual assertions, one of which escaped into a follow-up task. |
| evidence_integrity | minor | — | Two CLAUDE.md files were edited, one flagged at 14863/16384 bytes, yet no `--check-claude-md` or byte-ceiling oracle run is recorded. The ceiling appears respected by inspection of the diff, but that is inference, not measurement. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Replace AC-FALS-12/13's frozen file enumerations with a discovery-based oracle (glob or symbol query resolved at run time) so an under-inclusive authoring-time list can no longer pass green. | The residual the plan accepted in writing was measured in this same slice: ac-service.test.ts escaped the enumeration and went red on merged main. |
| plan | Add an explicit evidence row for the pass_unfalsified count invariant (`lore status --json` before/after) and remove or scope-correct the '0 mismatches' sentence in packages/lore/src/adapters/cli/CLAUDE.md. | Plan item 4 demanded a run, not reasoning; the prose claim is currently unbacked and reads as contradicted by AC-FALS-23. |
| plan | Either narrow the plan's ac_scope to the M4/M5 criteria actually executed, or record runs for AC-FALS-1..10 on the landing commit. | With no ac_scope declared, ten prior-slice criteria are carried as in-scope-but-unevidenced, which makes the bundle's coverage read weaker than the work actually is. |
| process | When a derivation widens a shared output row shape (e.g. recorded_at on EvidenceRefLite), require a criterion pinning the serialized surface, not just the in-memory type. | The change was detected only by incidental snapshot breakage, and one break escaped the slice entirely. |
| spec | Extend AC-FALS-20 to require not_measured be distinguishable from fail in the dashboard, or add a fifth badge variant. | The CLI separates ⚠ from ✘; the dashboard collapses both to 'destructive', so the two surfaces disagree on how loud a bookkeeping defect is. |

## Unverifiable Materials

- packages/dashboard/tests/unit/typecheck-scope.test.ts: Omitted from the shown diff per the truncation manifest; AC-FALS-22/24 rest on assertions inside it that I could not read, only on its attested green runs.
- packages/dashboard/tsconfig.tests.json and root package.json: Omitted from the shown diff; the corrected exclude, the tests/e2e entry and its required residual comment, and the typecheck chain wiring could not be inspected directly.
- lore status --json pass_unfalsified_count before/after the change: No evidence row records a status run, so the 'count must not move' requirement and the CLAUDE.md '0 mismatches' claim are both unmeasured in these materials.
- packages/lore/tests/unit/adapters/evidence-pipe-refusal.bun.test.ts, evidence-pipe-wiring.bun.test.ts, packages/lore/tests/unit/service/unclaimed-oracle.test.ts: AC-FALS-7/8/9's declared oracles are neither run in any evidence row nor present in the diff.
- CLAUDE.md byte-ceiling status after the two doc edits: No --check-claude-md oracle run is recorded; core/CLAUDE.md's post-edit size can only be estimated from the diff, and cli/CLAUDE.md's budget is unknown.

## Facts Summary

- AC coverage: 24 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.30
