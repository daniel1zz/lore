---
id: KN-013
type: knowledge
role: knowledge
title: "Assessment: SPEC-029 Implementation — assess reliability (2026-07-03)"
status: archived
priority: medium
created: 2026-07-03
updated: 2026-10-23
tags: []
parent: PLAN-009
links:
  - {id: PLAN-009, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KWK9R46DGZXZJ806F7QR5D47`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-AR-1 | 92 | assess-template.ts adds an explicit 300-char + clip statement to the Output Instruction; prompt_version bumped 1→2. Tests assert the statement in the base prompt AND in a retry prompt built end-to-end via buildAssessRetryPrompt, not just the docstring claim. | task-implement-assess-reliability-prompt-limit-statement-lenient (diff: assess-template.ts; test: ai-provider-service-assess.test.ts AC-AR-1 block) |
| AC-AR-2 | 95 | clipOverlongReasoning/clipTextToBudget are pure exported @lore/core functions with trailing '…', applied in _attemptJudgeParse BEFORE llmAssessmentOutputSchema.safeParse on both attempts. Integration test proves one provider call, retried=false, reasoning ≤300. | task-implement-assess-reliability-prompt-limit-statement-lenient (diff: assessment.ts, ai-provider-service.ts; ~30 unit tests) |
| AC-AR-3 | 93 | judgment.reasoning_clipped added as optional string[] of ac_ids (rationale in docstrings), omitted when empty; renderAssessmentContent emits 'Reasoning clipped for:' line. Tests cover legacy-shape validation, new-shape validation, rendering presence/absence, and key-omission semantics. | task-implement-assess-reliability-prompt-limit-statement-lenient (judgmentSchema + renderAssessmentContent tests) |
| AC-AR-4 | 86 | Retry/fail-loud path structurally unchanged in _attemptJudgeParse; extended bun e2e asserts double-malformed → exit 6 AI_PROVIDER_ERROR. Evidence reports full suites green (1985 vitest + 537 bun). 'No document created' on second failure not directly re-asserted in this diff; relies on prior tests. | task-implement-assess-reliability-prompt-limit-statement-lenient (evidence [2]; assess-ai.bun.test.ts) |
| AC-AR-5 | 92 | formatError gains aiHasNoFallback opt; assess.ts passes it on the assess failure branch. Unit tests pin absence of '--no-ai' and presence of retry/provider-check/raw-output guidance; bun e2e verifies real stderr bytes. Regression tests keep the default hint for create/set/link callers. | task-implement-assess-reliability-prompt-limit-statement-lenient (utils.ts + cli-utils.test.ts + e2e stderr test) |
| AC-AR-6 | 84 | HAPPY/NEGATIVE/BOUNDARY/STATE/REGRESSION explicitly covered incl. exact-300, multi-AC partial clip, and a non-vacuous surrogate-pair test; sequence-mode integration test shows success + persisted reasoning_clipped. No describe block labeled ERROR — never-throws NEGATIVE tests cover it only implicit… | task-implement-assess-reliability-prompt-limit-statement-lenient (assessment.test.ts clip suites; ai-provider-service-assess.test.ts integration) |

## Gaps

- No explicitly labeled ERROR-dimension test for the clip functions; the six-dimension convention is satisfied only if the NEGATIVE never-throws suite is counted as ERROR coverage.
- Closeout task (oracles + rebuild + self-assess with new binary) is still status=draft with zero evidence — the round-3 loop is not closed; claims of the new binary self-assessing successfully are unverified.
- AC-AR-4's 'no document is created' clause is evidenced only via pre-existing regression tests referenced in the evidence tail, not directly visible in the provided diff.
- Integration test asserts result.value.judgment fields but does not itself re-verify the persisted knowledge doc contains the rendered 'Reasoning clipped for:' line end-to-end.

## Recommendations

- Complete the closeout task: rebuild the binary and run a live self-assess to confirm the clip path and new hint work on the real claude-cli provider, recording SPEC-025 evidence.
- Add an explicit ERROR-labeled test (or rename/annotate the never-throws NEGATIVE cases) so the six-dimension convention is auditable without interpretation.
- Add one end-to-end assertion that the persisted assessment doc's content includes the 'Reasoning clipped for:' line when clipping occurred.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 74002ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-AR-6
