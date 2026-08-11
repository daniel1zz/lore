---
id: KN-269
type: knowledge
role: knowledge
title: "Assessment: D5: an escalate present blocks even alongside a reject (2026-07-31)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-091
links:
  - {id: PLAN-091, type: informs}
---
# Assessment: partially_met (62/100)

Scope: plan `01KYW96A72Q8Y4F8G34MGS4RG3`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ESC-9 | 85 | 3 recorded passes, 1 attested by main-orchestrator in the repo root running the exact -t filter; 'Tests 4 passed' (>0) defeats the zero-match-exit-0 trap. No RED-first capture and no diff, so 'inverted, not deleted' and the code change itself are unverified. | 01KYW984EBSFV4SB67R55SHR86 (evidence [1] worktree run, [4] attested root run) |
| AC-ESC-6 | 85 | `bun run typecheck` recorded as 1 pass, all five tsc projects invoked with no error lines. Output tail is truncated mid-line and the run is self-reported (0 attested), so the dashboard leg's completion is not visible. | 01KYW984EBSFV4SB67R55SHR86 (evidence [3]) |
| AC-ESC-1 | 55 | 0 pass / 0 fail: its named -t command was never run in this plan. Only indirect cover is `test:changed` (52 files, 864 tests, includes review-judgment-escalate-scope.test.ts), which is self-reported and does not isolate this AC's title. | 01KYW984EBSFV4SB67R55SHR86 (evidence [2], indirect only) |
| AC-ESC-2 | 55 | Load-bearing negative (reject on ungated still approves) has 0 recorded runs. This is the AC most at risk from D5's change, since the new escalate check sits in the same ungated branch. Only whole-file `test:changed` covers it, unattested. | 01KYW984EBSFV4SB67R55SHR86 (evidence [2], indirect only) |
| AC-ESC-3 | 55 | Empty-list kill switch invariant has 0 recorded runs of its own command. AC-ESC-9's second control (empty list approves the pair) is inside the D5 filtered run and passed, which partially covers the same invariant but not this AC's assertion. | 01KYW984EBSFV4SB67R55SHR86 (evidence [1]/[4] control overlap; [2] indirect) |
| AC-ESC-4 | 55 | blocking_questions rendering has 0 recorded runs. Task digest notes the pair must still carry the escalating judgment's blocking_questions once it blocks; nothing in the trail asserts the denial message for the new reject+escalate path. | 01KYW984EBSFV4SB67R55SHR86 (evidence [2], indirect only) |
| AC-ESC-5 | 55 | Gated-types-unchanged has 0 recorded runs. AC-ESC-9's first control (gated pair still blocks on reject) is green inside the D5 run, which covers the reject direction but not the 'approve still approves' half this AC pins. | 01KYW984EBSFV4SB67R55SHR86 (evidence [1]/[4] partial control overlap) |
| AC-ESC-7 | 55 | No-judgment / ai_provenance-collision precondition has 0 recorded runs, despite the plan flagging it as 'the case most likely to break'. Only the aggregate `test:changed` run touches it; self-reported, no per-AC line. | 01KYW984EBSFV4SB67R55SHR86 (evidence [2], indirect only) |
| AC-ESC-8 | 55 | config.ts @invariant prose oracle has 0 recorded runs, and the config source is not in the materials. D5 does not obviously change that prose, but with no diff and no run the documentation contract cannot be confirmed still-satisfied. | 01KYW984EBSFV4SB67R55SHR86 (evidence [2], indirect only) |

## Gaps

- The task mandated a RED-first capture: with the BOUNDARY test inverted and the code unchanged, AC-ESC-9 must fail. No failing run is recorded. Combined with the absent diff, the trail cannot distinguish a real fix in enforceJudgmentRequiredGate from a test rewritten to match existing behaviour.
- diff_available=false means none of the plan's hard constraints are verifiable: that checkReviewJudgment / worstReviewDecision / REVIEW_DECISION_RANK were untouched, that only the ungated branch changed, that the BOUNDARY test was inverted rather than deleted, and that generated/assets-manifest.ts was not committed.
- AC-ESC-1..5, 7 and 8 have 0 pass / 0 fail. The plan names them an 'unchanged regression floor' but no per-AC oracle was run. AC-ESC-2 (reject on ungated still approves) and AC-ESC-4 (blocking_questions rendering on the now-blocking pair) are the highest-risk of these, as both live in the exact branch D5 modified.
- Coverage declares '3 pass (1 attested)' but both filtered runs report 'Tests 4 passed | 17 skipped (21)'. The fourth matching test is unidentified, so the mapping from suite titles to the AC's inverted test plus two named controls is not established from the materials.
- The typecheck output tail is clipped mid-line at '@lore/dashboard ty', so the final project's exit is not visible in the record; the pass rests on the recorder's assertion rather than on readable oracle output.

## Recommendations

- For any task whose objective includes inverting or rewriting an existing passing test, require two evidence records for the AC: a result=fail run of the same command against the pre-change implementation, then the result=pass run. Reject green-only trails for such tasks.
- Require a diff (or per-file hunks for the named File Anchors) in the task evidence bundle whenever the plan states hard constraints about files that must NOT change.
- When a plan names AC-ESC-1..8 an unchanged regression floor, either declare extra.ac_scope = [AC-ESC-9] so the floor is judged as pre-existing, or run each floor AC's own -t command once and record it. Do neither and every floor AC audits as unevidenced.
- Attest the aggregate runs (typecheck, test:changed) from the repo root as was done for the AC-ESC-9 filtered run, and store full output tails; attested ratio here is 0.25.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 78780ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.6 | evidence | AC-ESC-9 green with 1 attested run and non-zero test count; regression floor covered only by an aggregate 52-file/864-test run, not per-AC oracles. |
| evidence_integrity | 52 | low | absence | attested ratio 0.25, no diff, no RED capture on a task whose core act was inverting a passing test, truncated tsc tail. Green-only trail is weakly falsifiable. |
| scope_fidelity | 60 | low | absence | Single phase, single archived task, commands match the plan's oracle. But with no diff, the four hard constraints (predicate untouched, gated path intact) are unchecked. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-ESC-9 | The task mandated a RED-first capture: with the BOUNDARY test inverted and the code unchanged, AC-ESC-9 must fail. No failing run is recorded. Combined with the absent diff, the trail cannot distinguish a real fix in enforceJudgmentRequiredGate from a test rewritten to match existing behaviour. |
| scope_fidelity | major | — | diff_available=false means none of the plan's hard constraints are verifiable: that checkReviewJudgment / worstReviewDecision / REVIEW_DECISION_RANK were untouched, that only the ungated branch changed, that the BOUNDARY test was inverted rather than deleted, and that generated/assets-manifest.ts was not committed. |
| outcome | major | AC-ESC-2 | AC-ESC-1..5, 7 and 8 have 0 pass / 0 fail. The plan names them an 'unchanged regression floor' but no per-AC oracle was run. AC-ESC-2 (reject on ungated still approves) and AC-ESC-4 (blocking_questions rendering on the now-blocking pair) are the highest-risk of these, as both live in the exact branch D5 modified. |
| evidence_integrity | minor | AC-ESC-9 | Coverage declares '3 pass (1 attested)' but both filtered runs report 'Tests 4 passed \| 17 skipped (21)'. The fourth matching test is unidentified, so the mapping from suite titles to the AC's inverted test plus two named controls is not established from the materials. |
| evidence_integrity | minor | AC-ESC-6 | The typecheck output tail is clipped mid-line at '@lore/dashboard ty', so the final project's exit is not visible in the record; the pass rests on the recorder's assertion rather than on readable oracle output. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | For any task whose objective includes inverting or rewriting an existing passing test, require two evidence records for the AC: a result=fail run of the same command against the pre-change implementation, then the result=pass run. Reject green-only trails for such tasks. | A test-inversion task is the one shape where a green run alone carries almost no signal about the source change. |
| process | Require a diff (or per-file hunks for the named File Anchors) in the task evidence bundle whenever the plan states hard constraints about files that must NOT change. | Constraints like 'do not modify worstReviewDecision' are only auditable against a diff; test output cannot show them. |
| plan | When a plan names AC-ESC-1..8 an unchanged regression floor, either declare extra.ac_scope = [AC-ESC-9] so the floor is judged as pre-existing, or run each floor AC's own -t command once and record it. Do neither and every floor AC audits as unevidenced. | AC Scope Facts show no ac_scope declared, so all nine ACs were scored, with seven having zero runs. |
| process | Attest the aggregate runs (typecheck, test:changed) from the repo root as was done for the AC-ESC-9 filtered run, and store full output tails; attested ratio here is 0.25. | The single attested record covers only one of four evidence entries, leaving the broadest regression signal self-reported. |

## Unverifiable Materials

- Implementation diff for packages/lore/src/service/review-service.ts: diff_available=false; the ungated-branch escalate condition cannot be inspected.
- Diff for packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts: No diff and tests_touched=false, so whether the BOUNDARY test at line 213 was inverted rather than deleted is unconfirmed.
- RED-run evidence for AC-ESC-9: Task test discipline required capturing the failing run pre-fix; no result=fail record exists in the trail.
- Per-AC oracle runs for AC-ESC-1, 2, 3, 4, 5, 7, 8: 0 pass / 0 fail recorded; only an aggregate test:changed summary covers the file.
- packages/core/src/config.ts judgment_required_types @invariant block: Source not in materials and AC-ESC-8's scanning test was not run in this plan.
- Explicit before-and-after statement for the two AC-ESC-9 controls: Required by the task's test discipline; not present in any evidence output tail.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.
- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 9 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.25

## Orchestrator correction (post-hoc, measured 2026-07-31 · agent:main-orchestrator)

Appended after the judgment was saved. `diff_available=false`; the `scope_fidelity`
absence claim follows from that. Judgment left intact; dispositioned below against
measurements, with anything that is NOT an independent re-measurement labelled.

**`scope_fidelity` — "the four hard constraints (predicate untouched, gated path intact)
are unchecked." REFUTED, all four:**

| constraint | measurement |
|---|---|
| `checkReviewJudgment` untouched | `git diff b50c01c f434dde -- checkpoint-registry.ts` → **0 lines**. The commit does not touch that file at all. |
| `worstReviewDecision` / `REVIEW_DECISION_RANK` untouched | `git diff 35ee2e6 HEAD -- checkpoint-registry.ts` filtered for those symbols → **0 lines**, across ALL of today's merges, not just this one. |
| gated path intact (reject+escalate still blocks on the REJECT) | LIVE probe on a freshly rebuilt `dist/lore`: `lore approve adr-distribution-first-…` → exit 4, `Gate "review-judgment" blocked: JUDGMENT_REJECTED`. Anti-lottery is intact at the surface, not merely in a unit test. |
| manifest / `bun.lock` not committed | `git show --name-only f434dde \| grep -cE "assets-manifest\|bun.lock"` → **0**. |

The fix's shape is why the predicate could stay untouched: the service narrows the
decision VECTOR it hands the predicate for ungated types
(`independentDecisions.filter(d => d === "escalate")`) rather than reinterpreting the
predicate's verdict. Worst-decision-wins over an escalate-only vector yields `escalate`
whenever one is present, so "is ANY an escalate?" and "is the WORST one?" coincide for
ungated types — and the gated path keeps the full vector, so its semantics are
untouched by construction rather than by careful avoidance.

**`evidence_integrity` — "no RED capture on a task whose core act was inverting a passing
test." STANDS as a record-keeping gap; NOT an independent re-measurement.** The
implementer reports the red (exit 1, `Tests 2 failed | 2 passed | 17 skipped`, both D5
cases failing on `expected true to be false`, with the 2 passing being the controls — so
the same run is the BEFORE proof for the controls). That is a well-designed red, and it
is absent from the corpus because `lore evidence` records only passing runs.

This is the FOURTH assessment in one session to raise the same gap (SL AC-SL-7's negative
control, R2 AC-R2-1, ESC's red baseline, and now D5). Four independent judgments
converging on one missing capability is the signal this repo treats as a
build-it-now trigger rather than a recurring note: an evidence row whose expected result
is `fail`, so a RED-first obligation can be discharged into the corpus instead of into a
subagent transcript that is discarded.

**One gap the implementer named that I did not close:** no prose oracle asserts the
`config.ts` `@invariant` block covers the reject+escalate PAIR case specifically. The
block already said "once this list is non-empty an escalate blocks approval for EVERY doc
type, listed or not" — which D5 makes true rather than aspirational, so no edit was
needed. AC-ESC-8's three assertions stay green. Left as-is: adding an assertion that
prose covers a sub-case invites pinning wording rather than behaviour.

**CORRECTION (same session, after a verification pass): the capability was NOT missing —
the discipline was.** The paragraph above proposed mechanizing "an evidence row whose
expected result is fail". Before building it, this repo's own standing rule was applied —
*a twice-recommended mechanization triggers a VERIFICATION pass first, not a build pass* —
and it refuted the proposal:

`lore evidence --result` already accepts **`pass | fail | expected-fail`**, with
`expected-fail` purpose-built for exactly the RED-first case (governing work:
`task-m1-evidence-result-vocabulary-expected-fail-ac-wh-1`, "evidence RED vocabulary";
the CLI even renders a distinct `⚑R` marker for it). The corpus already holds 146
`result=fail` rows out of 3067.

So the real root cause is upstream of lore: **the dispatch bundles said "RED FIRST … capture
that output" and never told the implementer to record it with `--result expected-fail`.**
Every bundle in this session omitted that instruction, so every red landed in a subagent
transcript that is discarded instead of in the corpus. The fix belongs in the dispatch
template, not in the tool.

Left in place rather than deleted so the near-miss is legible: without the verification
pass, this session would have recorded a corpus claim that lore lacks a capability it
shipped.
