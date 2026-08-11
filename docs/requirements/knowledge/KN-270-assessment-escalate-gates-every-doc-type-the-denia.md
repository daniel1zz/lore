---
id: KN-270
type: knowledge
role: knowledge
title: "Assessment: escalate gates every doc type + the denial names the questions (2026-07-31)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-092
links:
  - {id: PLAN-092, type: informs}
---
# Assessment: partially_met (77/100)

Scope: plan `01KYW74K1TATZZ5C7D1KF03APN`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ESC-1 | 80 | Two passing runs of the named filter (agent + orchestrator-attested), 2 tests matched so the filter is non-vacuous per the plan's own guard. Downgraded: no diff and no RED record, so it cannot be confirmed the test would fail against unmodified code. | 01KYW7DC59YRR0BBADTPT28M2F (evidence [1], [10]) |
| AC-ESC-2 | 78 | Negative guard evidenced by two passing runs with 2 matched tests. As a pre-existing green regression floor its pass is weak proof that reject scoping was consciously preserved rather than untouched; no diff to confirm the caller-side split. | 01KYW7DC59YRR0BBADTPT28M2F (evidence [2], [11]) |
| AC-ESC-3 | 80 | Kill-switch invariant has two passing runs, 2 matched tests. Plan correctly identifies this as the SOLE guard for the one behaviour the change could break. Cannot verify from materials that the [] short-circuit precedes the escalate path in code. | 01KYW7DC59YRR0BBADTPT28M2F (evidence [3], [12]) |
| AC-ESC-4 | 72 | Second headline deliverable: 3 matched tests pass in both runs (agent + attested), consistent with verbatim-questions plus empty-array branch. But message-rendering content is unverifiable without the diff or assertion text; no RED record though the plan bound one here. | 01KYW7DC59YRR0BBADTPT28M2F (evidence [4], [13]) |
| AC-ESC-5 | 78 | Regression floor evidenced twice with 4 matched tests, covering both directions. Broader suite run test:changed also passed, adding some confidence gated types were not weakened. | 01KYW7DC59YRR0BBADTPT28M2F (evidence [5], [14], [9]) |
| AC-ESC-6 | 85 | Full monorepo typecheck passes in two independent runs across core, lore, lore-tests, scripts, dashboard. Strongest oracle in the bundle; it proves compilation only, not the prose edit (AC-ESC-8's job). | 01KYW7DC59YRR0BBADTPT28M2F (evidence [6], [15]) |
| AC-ESC-7 | 78 | Over-widening guard passes twice with 2 matched tests, covering no-judgment and provenance-collision cases. Pre-existing green floor, so pass alone does not distinguish correct narrow change from no change; no diff available. | 01KYW7DC59YRR0BBADTPT28M2F (evidence [7], [16]) |
| AC-ESC-8 | 68 | Doc-contract oracle passes twice with 3 matched tests, including the anti-vacuity control the AC requires. Weakest link: the source-scanning test and the config.ts prose were authored together and no diff is shown, so the prose update itself is unverified here. | 01KYW7DC59YRR0BBADTPT28M2F (evidence [8], [17]) |

## Gaps

- The task's test discipline explicitly binds RED-first for AC-ESC-1 and AC-ESC-4, distinguishing them from the regression floors AC-ESC-2/3/5/7. No failing pre-change run is recorded for either, so a green pass cannot distinguish a real behaviour change from a test that would also pass against unmodified code.
- diff_available=false. The three edits the plan calls one contract — the caller-side verdict-aware split in review-service.ts, blocking_questions rendering in feedReviewJudgment, and the config.ts @invariant prose — are judged solely from pass records. In particular D3's requirement that [] short-circuits BEFORE the escalate path is asserted only behaviourally by AC-ESC-3.
- AC-ESC-8 is a source-text scan authored alongside the source it scans. Its anti-vacuity control is a good design, but with no diff there is no independent confirmation the @invariant block now states reject-only scoping and the preserved empty-list kill switch.
- Regression signals report tests_touched=false and diff_available=false, so the bundle cannot confirm which files were actually modified — including the constraint that checkpoint-registry.ts's predicate was left unmodified and that generated/assets-manifest.ts was not committed.

## Recommendations

- Require the RED run to be recorded as failing evidence (result=fail at the pre-change ref) for any AC the task marks RED-first, and reject bundles where a RED-first AC has only passing records.
- Include the diff in the audit bundle, or at minimum the changed hunks for the declared file anchors, whenever a plan asserts that code, message and documentation edits form one contract.
- Add an AC or evidence step pinning the ORDER of the two short-circuits ([] kill switch before the escalate path), not just their combined behaviour.
- Define attestation as independent verification of the change site, not re-execution of the same AC commands by a second recorder.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 63537ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.65 | evidence | All 8 ACs have two passing oracle runs with non-zero matched test counts, plus a green full typecheck and test:changed. Content of the behaviour and message changes unseen. |
| evidence_integrity | 66 | low | absence | Attestation ratio 0.47 and attested runs merely replay the same commands; no RED evidence despite a binding RED-first rule; no diff to anchor any pass. |
| scope_fidelity | 74 | low | absence | Single phase, single task, all 8 declared ACs exercised, no extra ACs claimed. Cannot confirm the predicate stayed untouched or that forbidden paths (manifest, .lore/) were avoided. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-ESC-1 | The task's test discipline explicitly binds RED-first for AC-ESC-1 and AC-ESC-4, distinguishing them from the regression floors AC-ESC-2/3/5/7. No failing pre-change run is recorded for either, so a green pass cannot distinguish a real behaviour change from a test that would also pass against unmodified code. |
| outcome | major | — | diff_available=false. The three edits the plan calls one contract — the caller-side verdict-aware split in review-service.ts, blocking_questions rendering in feedReviewJudgment, and the config.ts @invariant prose — are judged solely from pass records. In particular D3's requirement that [] short-circuits BEFORE the escalate path is asserted only behaviourally by AC-ESC-3. |
| evidence_integrity | minor | AC-ESC-8 | AC-ESC-8 is a source-text scan authored alongside the source it scans. Its anti-vacuity control is a good design, but with no diff there is no independent confirmation the @invariant block now states reject-only scoping and the preserved empty-list kill switch. |
| scope_fidelity | minor | — | Regression signals report tests_touched=false and diff_available=false, so the bundle cannot confirm which files were actually modified — including the constraint that checkpoint-registry.ts's predicate was left unmodified and that generated/assets-manifest.ts was not committed. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the RED run to be recorded as failing evidence (result=fail at the pre-change ref) for any AC the task marks RED-first, and reject bundles where a RED-first AC has only passing records. | Without a recorded failure, a new test's green pass is not evidence of a behaviour change. |
| process | Include the diff in the audit bundle, or at minimum the changed hunks for the declared file anchors, whenever a plan asserts that code, message and documentation edits form one contract. | Every AC here degrades to trust-the-runner because no code was reviewable. |
| plan | Add an AC or evidence step pinning the ORDER of the two short-circuits ([] kill switch before the escalate path), not just their combined behaviour. | D3 is an ordering constraint; a behavioural test can pass under an ordering that is fragile to later edits. |
| process | Define attestation as independent verification of the change site, not re-execution of the same AC commands by a second recorder. | Replaying identical commands raises the attested count without adding information. |

## Unverifiable Materials

- Implementation diff (packages/lore/src/service/review-service.ts, packages/core/src/config.ts, new test file): diff_available=false; no code shown, so the gate logic, denial rendering and @invariant prose cannot be inspected.
- RED (pre-change failing) runs for AC-ESC-1 and AC-ESC-4: No failing evidence record exists; all 17 records are result=pass.
- Assertion bodies of the 18 tests in review-judgment-escalate-scope.test.ts: Only vitest summary tails are provided; what each test asserts, especially verbatim question rendering, is unseen.
- Non-modification of checkpoint-registry.ts and exclusion of generated/assets-manifest.ts: No diff or file list to confirm these task constraints were honoured.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.
- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.47

## Orchestrator correction (post-hoc, measured 2026-07-31 · agent:main-orchestrator)

Appended after the judgment was saved. The judge ran with `diff_available=false`; the
`scope_fidelity` and `evidence_integrity` absence claims follow from that. Judgment left
intact; each is dispositioned below against a measurement, with anything that is NOT an
independent re-measurement labelled as such.

**`scope_fidelity` — "cannot confirm the predicate stayed untouched or that forbidden
paths (manifest, `.lore/`) were avoided." All three REFUTED by direct inspection:**

- **D2, predicate untouched:** `git diff 35ee2e6..HEAD -- checkpoint-registry.ts` contains
  no change line touching `checkReviewJudgment`, `worstReviewDecision`, or
  `REVIEW_DECISION_RANK`. The only additions are `isJudgmentEscalatedDenial` (a new
  exported outcome-classifier) and `renderBlockingQuestions` (a new helper), so the
  predicate remains the single decision authority.
- **Manifest:** `git show --name-only 60342eb | grep -c assets-manifest` → 0.
- **`.lore/` writes:** the new suite's single `.lore/` occurrence is a COMMENT stating the
  prohibition (line 10); the store is `InMemoryStore` throughout (line 60). No corpus write.

**`evidence_integrity` — "no RED evidence despite a binding RED-first rule." STANDS as a
record-keeping gap, with a caveat: the implementer's report DOES carry a red baseline
(7 failed / 11 passed at `35ee2e6`, saved to a scratchpad file) and an AC-ESC-3
discrimination probe (removing the `[]` short-circuit turned AC-ESC-3 red while the
pre-existing AC-TIER-7 kill-switch test stayed GREEN — measured confirmation that
AC-ESC-3 is the sole guard). None of that is in the corpus, because `lore evidence`
records only passing runs. Same gap the R2 and SL assessments raised — general to the
evidence model, not to this task, and worth mechanizing as an evidence row whose expected
result is `fail`.

## Live end-to-end confirmation the judged bundle could not contain

The implementer explicitly listed "no end-to-end CLI probe" as an unverified gap, arguing
statically that `ReviewService` is the only builder of a `review-judgment` GateContext.
Closed here with a live run on a freshly rebuilt `dist/lore` (which `which lore` resolves
to via symlink):

```
lore approve adr-product-skill-chain-derive-features-via-ost-execute-graded
EXIT=4
Gate "review-judgment" blocked: JUDGMENT_ESCALATED
  ... it asserts an OUTSTANDING HUMAN DECISION, which blocks approval for EVERY doc type
      regardless of `workflow.review.judgment_required_types`.
  Blocking questions from the escalating judgment (answer these, then re-review):
  - Under the Minimal-PRD short-circuit, which chain edge into `prd` is legal? ...
```

Both halves of the deliverable are visible at the surface: the escalate-specific rule
text, and the question rendered verbatim. Before this change the same denial printed only
the recovery command — measured earlier in this session when this very gate blocked the
governing ADR and the questions had to be read out of SQLite by hand.

Side effect worth recording: that probe surfaced a real owner-facing question which had
been sitting unread in `review_judgments` (the Minimal-PRD chain-edge legality). The
mechanism is already paying for itself on its first live invocation.

## Known defect this plan did NOT close, relative to its own governing ADR

A `reject` alongside an `escalate` on an ungated type resolves by worst-decision-wins to
`JUDGMENT_REJECTED`, which the service suppresses for ungated types — so the doc
APPROVES and the escalate is lost. The implementer surfaced this and pinned it as an
explicit BOUNDARY test rather than hiding it.

It contradicts the governing ADR ("filing an escalate silently is never right for any
type"), and the inversion is the point: adding a WEAKER signal (a reject, which we
deliberately treat as suppressible opinion) destroys a STRONGER one (a required human
decision). It is reachable — `lore review` does not bump the doc version, so two runs on
one version yield two same-version judgments that may disagree.

Not closed here because the plan is terminal; recorded as the next step so it is not
rediscovered. The fix is small and does not need the predicate: the service already holds
`independentDecisions` before building the GateContext, so the ungated path can ask
`independentDecisions.includes("escalate")` directly instead of reading the worst-decision
denial reason.

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
