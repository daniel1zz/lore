---
id: KN-014
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
# Assessment: met (84/100)

Scope: plan `01KWK9R46DGZXZJ806F7QR5D47`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-AR-1 | 72 | Base prompt in assess-template.ts adds the explicit 300-char limit + clip warning; retry-prompt coverage rests on a doc-comment claim that it embeds the base prompt verbatim. Tests asserting the statement in BOTH prompt texts are claimed in evidence [2] but not visible in the diff. | task-implement-assess-reliability-prompt-limit-statement-lenient (assess-template.ts diff; evidence [2] cites ai-provider-service-assess.test.ts +5 AC-AR-1/2/6 tests) |
| AC-AR-2 | 95 | clipTextToBudget/clipOverlongReasoning are pure exported functions in @lore/core; applied in _attemptJudgeParse BEFORE llmAssessmentOutputSchema.safeParse; trailing … marker; extensive visible unit tests. Fully evidenced in the diff. | task-implement-assess-reliability-prompt-limit-statement-lenient (assessment.ts + ai-provider-service.ts diffs; assessment.test.ts) |
| AC-AR-3 | 95 | judgmentSchema gains optional reasoning_clipped (additive-only); _finalizeAssessment sets it only when non-empty; renderAssessmentContent emits 'Reasoning clipped for:' line. Backward-compat and rendering tests (incl. legacy 5-bullet invariant) visible in the diff. | task-implement-assess-reliability-prompt-limit-statement-lenient (assessment.ts schema + renderer diff; judgmentSchema regression tests) |
| AC-AR-4 | 85 | Retry orchestration structure is unchanged (first/second attempt, AI_PROVIDER_ERROR with raw prefix on second failure); clip is pre-validation only. Evidence [2] reports full suites green (1985 vitest + 537 bun) incl. an extended double-malformed stderr assertion, though that test isn't in the diff. | task-implement-assess-reliability-prompt-limit-statement-lenient (ai-provider-service.ts diff; evidence [2] test run) |
| AC-AR-5 | 92 | assess.ts passes formatError({aiHasNoFallback:true}); utils.ts renders retry/provider-check/raw-output guidance instead of --no-ai. Visible cli-utils tests pin the new wording, ABSENCE of '--no-ai', and regression of the default hint for create/set/link callers. | task-implement-assess-reliability-prompt-limit-statement-lenient (assess.ts + utils.ts diffs; cli-utils.test.ts AC-AR-5 block) |
| AC-AR-6 | 70 | HAPPY/NEGATIVE/BOUNDARY/STATE/REGRESSION visible with exact-300 boundary, multi-AC partial clip, and surrogate safety; no explicitly labeled ERROR dimension (NEGATIVE never-throws cases partially cover it). The InMemoryAIProvider sequence-mode integration test is claimed in evidence but not shown. | task-implement-assess-reliability-prompt-limit-statement-lenient (assessment.test.ts diff; evidence [2] cites integration tests not included in materials) |

## Gaps

- The corrective-retry prompt (buildAssessRetryPrompt) is not in the diff — AC-AR-1's 'both prompt texts' requirement is verified only via a doc-comment claim and unshown tests.
- The AC-AR-6 integration test (InMemoryAIProvider sequence mode → doc persisted with reasoning_clipped visible) is cited in evidence output_tail but not present in the provided diff.
- No explicitly labeled ERROR-dimension tests for the clip functions; NEGATIVE never-throw cases only partially substitute.
- Closeout task (oracles + rebuild + self-assess with new binary) is status=draft with no evidence — the plan's end-to-end validation with the rebuilt binary is unverified.
- The diff mixes in unrelated SPEC-028 changes (truncateDiffByFile, pre-flight diff warning, assessMaxDiffChars), diluting attribution of this task's scope.

## Recommendations

- Include buildAssessRetryPrompt and its limit-statement test in the reviewed diff, or add a direct test asserting the 300-char statement in the retry prompt text specifically.
- Surface the sequence-mode integration test (overlong reasoning → assess succeeds, doc persisted, reasoning_clipped rendered) in the evidence trail or diff.
- Add an explicit ERROR-dimension case (or relabel the never-throw NEGATIVE cases) to make six-dimension coverage auditable.
- Complete the closeout task: rebuild the binary and record a self-assess run exercising the new clip path, with oracle evidence.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 81037ms
- Retried: false
- Truncated sections: (none)
