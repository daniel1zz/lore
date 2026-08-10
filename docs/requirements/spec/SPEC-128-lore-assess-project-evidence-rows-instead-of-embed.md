---
id: SPEC-128
type: spec
role: spec
title: "lore assess: project evidence rows instead of embedding the task body, and never author an absence finding against content the judge could not read"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
# lore assess: project evidence rows instead of embedding the task body, and never author an absence finding against content the judge could not read

## Overview

Measured 2026-08-01 on `lore assess plan-implementation-resume-coverage-floor-satisfaction`
(full account: `knowledge-a-task-doc-that-accumulated-10-evidence-rows`). One task doc
carrying 10 evidence rows overflowed its 4000-char bundle budget. The judge returned
`Overall confidence: low (degraded by truncation)` and then:

- **Two of four typed gaps were FALSE against the stored corpus data** — both asserted
  that a probe's `output_tail` "ends inside the S1 block", when the stored tail is 1022
  bytes and demonstrably spans both the S1 and S2 cases. They are artifacts of the
  truncated view, published into the permanent quality record in the same voice as the
  true findings.
- **The one real shortfall went unmentioned**: both red-first rows carried an empty
  `output_tail`. Row count and tail size are exactly the facts a projection would have
  surfaced, and exactly the facts the whole-body embedding buried.

Two compounding mechanisms make this worse over time. Evidence accumulates monotonically
(append-only, cap 50), so the MORE thoroughly a task is evidenced, the likelier its doc
overflows and the LOWER the resulting confidence — acting on the judge's advice to record
more evidence degrades the next assessment. And truncation is reported as a confidence
degradation rather than a refusal, so nothing downstream distinguishes "the judge did not
see this" from "the judge saw this and found it wanting".

## Scope

IN scope:

- The task block of both prompt builders — `buildAssessPrompt` (v5) and
  `buildAssessPromptV6` — in `packages/lore/src/ai/assess-template.ts`, plus
  `renderTaskEvidence` (`:173-189`).
- The post-judge finalization in `AiProviderService._finalizeAssessment`
  (`packages/lore/src/service/ai-provider-service.ts:1298-1370`), specifically the
  grounding path built from `findUngroundedAbsenceDimensions` (`:200-218`).

OUT of scope:

- The budget NUMBERS themselves (`packages/core/src/ai.ts:316-327`). Raising
  `max_task_chars` treats the symptom: the row cap is 50, so any fixed budget is
  overrunnable by a sufficiently well-evidenced task. The projection is the root fix.
- `ac_scores[]`. `based_on` exists only on `dimension_scores`
  (`assessment.ts:279-285`); extending the field is a separate change.
- The judge's flakiness / escalate-vs-approve instability — a different open thread.

## Design Decisions

**D1 — the evidence projection is `(oracle, ac_ref, result, command, tail_bytes)` per row,
plus the full (clipped) tail only for rows whose `ac_ref` is under judgment.** `tail_bytes`
is the load-bearing addition: it is what makes "this row shows nothing" visible as a fact
rather than as an absence the judge must notice.

**D2 — the `truncated[]` entry vocabulary is FROZEN.** Entries are consumed by
`computeTaskTruncationRatio` (`assessment.ts:745-748`, which keys off the `task:` prefix)
and by the substring grounding heuristic (`ai-provider-service.ts:200-218`), and the ratio
drives the verdict-forcing branch at `ai-provider-service.ts:1339-1341`. Any change to the
projection MUST keep emitting `task:<slug>` with unchanged semantics, or it silently
alters verdict behaviour. This is the single highest-risk coupling in the slice.

**D3 — an absence finding against truncated material is SUPPRESSED, not merely warned
about.** The rubric already detects the ungrounded shape and appends a `rubric_warning`
plus a confidence downgrade — and that is precisely what failed: the two false gaps were
warned about and published anyway. A warning that does not change what lands in the
permanent record is not a mechanism. The suppressed finding is not discarded silently: it
is re-expressed as an `unverifiable[]` entry naming the material, so the assessment still
records that something could not be judged.

**D4 — suppression keys on the SAME dimension-to-material match the existing warning
uses**, not on a new heuristic. Two detectors with different match rules for one condition
is its own defect; `findUngroundedAbsenceDimensions` is the SSOT for "this finding is
ungrounded", and D3 changes only the CONSEQUENCE of a positive match.

## Acceptance Criteria

Structured, machine-checkable criteria are declared via `lore ac add` and are the
authority. Prose restatement here is a reader's summary only.


## Acceptance Criteria (structured)

- [✔] [script] AC-AEP-1: renderTaskEvidence emits one line per evidence row carrying oracle, ac_ref, result, command and a tail_bytes count; a row whose output_tail is absent or empty renders tail_bytes=0 rather than omitting the field.
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-evidence-projection.test.ts -t 'AC-AEP-1'
- [✔] [script] AC-AEP-2: CORRECTED 2026-08-01 (the original statement's premise was unsatisfiable and its green was false): truncateSection measures task.content ALONE against max_task_chars (assess-template.ts:548,818) and the rendered evidence block is appended OUTSIDE that budget, so projecting evidence rows can never move a task out of truncated[]. What is actually verified, and what the passing test measures, is a SIZE fact on the assembled evidence block for a 10-row task — the projection bounds an otherwise unbudgeted section. The original truncated[] clause was withdrawn, not satisfied.
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-evidence-projection.test.ts -t 'AC-AEP-2'
- [✔] [script] AC-AEP-3: REGRESSION GUARD for D2: when a task block still exceeds its budget after projection, the emitted truncated[] entry is exactly the string 'task:' + slug, byte-identical to the pre-change vocabulary, so computeTaskTruncationRatio and the grounding substring match are unaffected.
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-evidence-projection.test.ts -t 'AC-AEP-3'
- [✔] [script] AC-AEP-4: Both prompt builders are covered: buildAssessPrompt (v5) and buildAssessPromptV6 emit the same projected evidence shape for the same input task.
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-evidence-projection.test.ts -t 'AC-AEP-4'
- [✔] [script] AC-AEP-5: A dimension_scores entry with based_on='absence' whose material matches a truncated[] entry is REMOVED from the persisted assessment's dimension findings, and a corresponding unverifiable[] entry naming that material is present in its place.
  script: test — bunx vitest run packages/lore/tests/unit/service/assess-absence-suppression.test.ts -t 'AC-AEP-5'
- [✔] [script] AC-AEP-6: CONTROL: a based_on='evidence' entry is never suppressed, and a based_on='absence' entry whose material matches NO truncated[] entry is never suppressed — suppression is scoped to the ungrounded-and-truncated intersection only.
  script: test — bunx vitest run packages/lore/tests/unit/service/assess-absence-suppression.test.ts -t 'AC-AEP-6'
- [✔] [script] AC-AEP-7: CONTROL for D4: suppression consumes findUngroundedAbsenceDimensions' verdict rather than re-deriving a match, proven by a case where that function's match rule and a naive equality check disagree — the suppression follows findUngroundedAbsenceDimensions.
  script: test — bunx vitest run packages/lore/tests/unit/service/assess-absence-suppression.test.ts -t 'AC-AEP-7'
- [✔] [script] AC-AEP-8: REGRESSION: the 100%-task-truncation branch still forces verdict='inconclusive' and omits overall_score, and the confidence downgrade still applies — suppression must not short-circuit the existing degradation path.
  script: test — bunx vitest run packages/lore/tests/unit/service/assess-absence-suppression.test.ts -t 'AC-AEP-8'
- [✔] [script] AC-AEP-9: ASSESS_PROMPT_VERSION is 7, and getAssessTemplate(6) still renders a task's evidence rows in the PRE-projection shape — byte-identical to the v6 output captured before the projection landed, so an assessment stamped prompt_version=6 remains reproducible.
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-prompt-version-freeze.test.ts -t 'AC-AEP-9'
- [✔] [script] AC-AEP-10: getAssessTemplate(7) renders the projected (oracle, ac_ref, result, command, tail_bytes) shape, and the renderer is injected into the shared builder rather than duplicated — one builder body serves both versions.
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-prompt-version-freeze.test.ts -t 'AC-AEP-10'
- [✔] [script] AC-AEP-11: A suppressed ungrounded absence dimension's matching typed_gaps entries are also removed, and the legacy gaps[] projection derived from them no longer contains the suppressed gap's text — the unverifiable[] entry's own claim ('rather than published as a finding') becomes true.
  script: test — bunx vitest run packages/lore/tests/unit/service/assess-absence-suppression.test.ts -t 'AC-AEP-11'
- [✔] [script] AC-AEP-12: CONTROL: a GROUNDED absence dimension keeps BOTH its dimension_scores row and its typed_gaps entry; based_on='evidence' dimensions and their typed gaps are untouched; and suppression emptying typed_gaps does not yield a verdict or summary asserting the work is clean.
  script: test — bunx vitest run packages/lore/tests/unit/service/assess-absence-suppression.test.ts -t 'AC-AEP-12'
