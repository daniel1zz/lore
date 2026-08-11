---
id: KN-187
type: knowledge
role: knowledge
title: "Assessment: Land oracle-tier falsifiability: falsified coverage dimension, pipe refusal, unclaimed-oracle check (2026-08-07)"
status: approved
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
links:
  - {id: PLAN-081, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01KZDK3F71XEXWKG6P0WAV0K7J`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-FALS-1 | 90 | Red-first control recorded (expected-fail: 'expected undefined to be 1') then two passes on the bound -t falsified-count oracle, one attested. Named test matches statement (expected-fail row → falsified:1, all-pass → 0). | task-derive-falsified-as-a-fourth-coverage-dimension-and-add (evidence [1],[4],[8]) |
| AC-FALS-2 | 88 | Own expected-fail control on -t coverage-state, then two passes (1 attested). Pass tails show only '1 passed \| 10 skipped' without the test name, so the assertion content is taken on the filter binding rather than re-read. | task-derive-falsified-as-a-fourth-coverage-dimension-and-add (evidence [2],[5],[9]) |
| AC-FALS-3 | 88 | Precedence-regression control red then green twice (1 attested). Guards that attested_pass still outranks the new state; pass tails are name-less so the specific precedence assertion is unverified from the bundle. | task-derive-falsified-as-a-fourth-coverage-dimension-and-add (evidence [3],[6],[10]) |
| AC-FALS-4 | 92 | Expected-fail tail shows the exact missing field (state undefined at ac-list-falsified line 277), then attested pass whose printed test name states falsified:0 + state:pass_unfalsified in --json. Statement and oracle align. | task-surface-pass-unfalsified-in-lore-ac-list-and-a-corpus-wide (evidence [3],[9],[15]) |
| AC-FALS-5 | 92 | Red control shows missing '[pass_unfalsified]' marker; attested pass test name asserts the marker present on a never-red criterion and absent on a sibling with one expected-fail ref — both halves of the statement. | task-surface-pass-unfalsified-in-lore-ac-list-and-a-corpus-wide (evidence [4],[10],[16]) |
| AC-FALS-6 | 92 | Red (pass_unfalsified_count undefined) then attested pass named 'count rises by exactly 1 ... and the exit code stays 0 both times' — the report-only constraint the plan warned an exit-code-blind AC would miss is actually asserted. | task-surface-pass-unfalsified-in-lore-ac-list-and-a-corpus-wide (evidence [5],[11],[17]) |
| AC-FALS-7 | 82 | Red-first then 3 passes (1 attested); named test asserts refusal for the piped self-report and null for the IDENTICAL command under --capture. But the oracle calls findPipeRefusal directly — 'exit 4' is a unit-level proxy; live exit status is only covered by AC-FALS-9. | task-refuse-a-self-reported-evidence-command-containing-a-shell (evidence [1],[2],[6]) |
| AC-FALS-8 | 88 | Red control ('expected [] to deep equally contain') then 3 passes incl. full-file run (6/6) and an attested filtered pass. Zero-finding half for a bound value is asserted by sibling cases in the same file, visible only as skipped names. | task-report-a-test-name-pattern-value-that-no-declared (evidence [1],[2],[3],[5]) |
| AC-FALS-9 | 94 | Strongest row: red shows the live CLI returning a generic validation error, green (attested) test name asserts the SAME piped --command exits 4 without --capture and 0 with it, from a spawned lore evidence process — not a source scan. | task-wire-findpiperefusal-into-the-live-lore-evidence-and-mcp (evidence [1],[2],[6]) |
| AC-FALS-10 | 92 | Red (unclaimed_oracle undefined on status --json) then attested pass naming both halves — unbound token reported, bound token zero findings, exit code 0. Fixture-based, so corpus-scale behaviour is inferred not measured. | task-surface-pass-unfalsified-in-lore-ac-list-and-a-corpus-wide (evidence [6],[12],[18]) |
| AC-FALS-11 | 84 | Expected-fail (TS2741 falsified missing) and a genuine result=fail mid-flight, then 4 passes (2 attested) showing 'Exited with code 0'. Tails are truncated mid-run, so 'every workspace sub-step' rests on the tsc oracle's own exit capture. | task-absorb-the-required-field-ripple-from-the-falsified (evidence [1],[5],[7]; surfacing [1],[7],[13],[19]) |
| AC-FALS-12 | 88 | Red control on the 8-file vitest set, then 2 passes (1 attested) with ✓ per file. Final tail is clipped before the summary line, so total counts/exit status are not visible in the bundle. | task-absorb-the-required-field-ripple-from-the-falsified (evidence [2],[4],[8]) |
| AC-FALS-13 | 88 | Expected-fail plus a real fail, then 4 passes (2 attested) with '39 pass / 0 fail' across the 3 files, including dashboard-assets-loader which itself shells typecheck. Literal-label file ([pass_unfalsified]) is in the set per the task note. | task-absorb-the-required-field-ripple-from-the-falsified (evidence [3],[6],[9]; surfacing [2],[8],[14],[20]) |

## Gaps

- 42 of 57 evidence rows are self-reported (attested ratio 0.26). Mitigated: every one of the 13 ACs has at least one attested pass, and AC-FALS-11/13 have two.
- AC-FALS-7 says the command 'exits 4' and 'exits 0', but its oracle calls findPipeRefusal directly and asserts a refusal object vs null; the exit codes appear only parenthetically in the test name. The property is genuinely covered by AC-FALS-9's live-process oracle, so this is a wording/oracle mismatch rather than a coverage hole.
- AC-FALS-11 and AC-FALS-13 each carry a result=fail row (not expected-fail) between the red control and the final green. The later attested passes supersede them, but nothing in the bundle records what regressed or why, so the fail reads as unexplained churn.
- Plan self-consistency: the stated dogfood test is 'if its criteria close pass_unfalsified'. Its own constraint requires every criterion to record an expected-fail control, which forces falsified>=1, so no criterion in this plan can close pass_unfalsified. The mechanism is not wrong; the plan's success sentence is.

## Recommendations

- Attach the diff (or a file-level change manifest) to the audit bundle for any plan whose constraints are source-level bans — SSOT reuse, do-not-touch files, required-vs-optional field shape.
- Restate the dogfood success condition so it is reachable under the plan's own red-first rule — e.g. 'every criterion shows falsified>=1 with an attested green', not 'closes pass_unfalsified'.
- Capture a knowledge doc on capability-vs-wiring anchoring: anchor the production call site in the same acceptance unit as the capability, and bind the oracle to a live process rather than a source scan.
- Reword AC-FALS-7 to describe what its oracle measures (findPipeRefusal returns a refusal for the piped self-report, null under --capture), leaving exit-status claims to AC-FALS-9.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 87650ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.75 | evidence | All 13 ACs have bound oracle passes; the three mechanisms plus surfacing landed, and the load-bearing controls (--capture half, exit-code-unchanged, bound-token zero) are named in passing tests. |
| evidence_integrity | 82 | 0.7 | evidence | Every AC carries its own expected-fail control and >=1 attested pass; ordering red->green is coherent. Offsetting: 0.26 attested ratio, clipped tails, and two ACs with unexplained interim fails. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | — | 42 of 57 evidence rows are self-reported (attested ratio 0.26). Mitigated: every one of the 13 ACs has at least one attested pass, and AC-FALS-11/13 have two. |
| outcome | minor | AC-FALS-7 | AC-FALS-7 says the command 'exits 4' and 'exits 0', but its oracle calls findPipeRefusal directly and asserts a refusal object vs null; the exit codes appear only parenthetically in the test name. The property is genuinely covered by AC-FALS-9's live-process oracle, so this is a wording/oracle mismatch rather than a coverage hole. |
| evidence_integrity | minor | AC-FALS-11 | AC-FALS-11 and AC-FALS-13 each carry a result=fail row (not expected-fail) between the red control and the final green. The later attested passes supersede them, but nothing in the bundle records what regressed or why, so the fail reads as unexplained churn. |
| outcome | minor | — | Plan self-consistency: the stated dogfood test is 'if its criteria close pass_unfalsified'. Its own constraint requires every criterion to record an expected-fail control, which forces falsified>=1, so no criterion in this plan can close pass_unfalsified. The mechanism is not wrong; the plan's success sentence is. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Attach the diff (or a file-level change manifest) to the audit bundle for any plan whose constraints are source-level bans — SSOT reuse, do-not-touch files, required-vs-optional field shape. | Four of this plan's five strongest constraints are unfalsifiable from oracle output alone. |
| plan | Restate the dogfood success condition so it is reachable under the plan's own red-first rule — e.g. 'every criterion shows falsified>=1 with an attested green', not 'closes pass_unfalsified'. | As written the plan asserts a state its own discipline makes impossible for all 13 criteria. |
| process | Capture a knowledge doc on capability-vs-wiring anchoring: anchor the production call site in the same acceptance unit as the capability, and bind the oracle to a live process rather than a source scan. | Two of six tasks here existed only to repair anchor scope; 0 knowledge docs were linked. |
| spec | Reword AC-FALS-7 to describe what its oracle measures (findPipeRefusal returns a refusal for the piped self-report, null under --capture), leaving exit-status claims to AC-FALS-9. | Keeps each AC's statement falsifiable by the oracle actually bound to it. |

## Unverifiable Materials

- Implementation diff (acceptance.ts derivation, commands/ac.ts, status, evidence.ts, mcp/tools.ts, scripts/ check): diff_available=false; no source shown, so code quality, SSOT reuse, and the do-not-touch bans cannot be checked.
- Full oracle stdout for AC-FALS-11 and AC-FALS-12 green runs: Tails are clipped mid-run (816/842 bytes), so per-sub-step exit statuses and final summary lines are not visible.
- Assertion bodies for AC-FALS-2, AC-FALS-3, AC-FALS-8 green runs: Pass tails report counts only, without test names; the specific properties rest on the -t binding.
- Corpus-scale behaviour of the pass_unfalsified count and unclaimed-oracle check: AC-FALS-6/10 are fixture-based; the 574-criterion back-catalogue and its exit-code neutrality at real scale are not measured here.
- scope_fidelity dimension score: Commit set unverifiable (convention mismatch — plan archived, no commit referenced any task slug). scope_fidelity was NOT SCORED, regardless of what the judge reported.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.26
