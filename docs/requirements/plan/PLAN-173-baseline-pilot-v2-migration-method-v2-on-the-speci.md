---
id: PLAN-173
type: plan
role: plan
title: "Baseline pilot v2: migration method v2 on the specification branch"
status: deprecated
priority: medium
created: 2026-10-08
updated: 2026-10-10
tags: []
parent: SPEC-156
phases:
  - {name: "P0 Freeze"}
  - {name: "P1 Method"}
  - {name: "P2 Measure"}
  - {name: "P3 Assess"}
---
# Plan: Baseline pilot v2 — migration method v2 on the specification branch

Parent: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations. Exit criterion: AC-BLS1-12 (kill lines pre-registered there before any measurement). Triggered by the v1 pilot failing both kill lines (`knowledge-pilot-assessment-baseline-slice-1-specification`); the owner said to continue in-session with all approvals delegated ("后面全自动", "直接当前Session继续").

## Goal
Test whether the migration METHOD — not the two-tree model, which v1 did not refute — can pass the same bars once its three root causes are removed: (1) placement by unwritten judgment, (2) rule truth by reading prose, (3) probe questions answered from rules that inherit doc errors.

## Method changes (v1 -> v2)
1. Written placement principle (ADR) applied by every mapper as an ordered decision procedure.
2. Every established/observed rule must be cited by >= 1 script-mode AC whose command falsifies it; a rule with none is downgraded to `unconfirmed` with an open question — never kept on prose alone. Rule truth then comes from attested evidence (BL-13), which is the mechanism that would have caught BR-73.
3. Known content defects fixed (BR-73 floor, missing digit-anchor rule), recorded as content fixes, not pilot passes.
4. NEW probe set frozen before any v2 leaf revision; NEW AC sample (seeded, >= 60 ACs, specs outside the v1 population) frozen before mapping.

## Execution constraint
Every task here writes the live corpus. Worktree agents are refused corpus writes (issue #39), so agents produce proposals/measurements read-only and the orchestrator records them from main as agent:main-orchestrator. No source code changes in this plan.

## Phases
- P0 Freeze: probe set v2; AC sample v2 (seed + freeze timestamp).
- P1 Method: placement principle ADR; content fixes; citation coverage pass.
- P2 Measure: two independent mappers + adjudication; blind reader on probe v2.
- P3 Assess: v2 pilot assessment against AC-BLS1-12; decision on slice 2.

## Risks
- Citation coverage may show most rules have no falsifying AC: then most rules downgrade to unconfirmed, the baseline shrinks, and that is itself the finding (excavated rules were mostly unbacked).
- Same branch as v1, so the blind reader is a different agent and sees only baseline docs.


## Review answers (v1 review blocking questions)
- **AC-BLS1-12 exists** on the parent spec, added before this plan was created and before any v2 measurement. Its bars are AC-BLS1-11's unchanged (adjudication <= 30%, blind >= 9/10 with 0 confident-wrong) plus one new bar (0 established/observed rules without a citing script-mode AC). No bar is relaxed.
- **Retry authority and count**: the v1 kill line stopped slice 2, not the baseline model; the v1 assessment's recommendations 2-4 prescribe exactly this re-measurement under a changed method, and the owner delegated approvals and said to continue. Exactly ONE retry: if v2 fires any kill line, the baseline migration method is stopped and the direction goes back to the owner — no v3 inside this delegation.
- **Probe count**: 10 questions in probe set v2.
- **Can downgrading inflate the scores? Controlled as follows**: downgrade never deletes rule text — an `unconfirmed` rule stays in its leaf, visible to the reader and to mappers, so mapping targets are unchanged. A downgrade can turn a would-be confident-wrong into an unsure answer, but an unsure answer does not score, so the >= 9/10 bar still requires correct answers. The assessment reports separately: number of rules downgraded, and how many probe answers rested on unconfirmed rules. If more than half the branch's rules are downgraded, that is reported as the finding that excavated rules were mostly unbacked, independent of the pass/fail verdict.


## Exit criterion record (verbatim, for reviewers who see only the spec body)
The spec BODY's AC table predates AC-BLS1-12; structured ACs are the SSOT (`lore ac list spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). Written as spec version v34 at 2026-10-08 01:56:22 UTC ('Acceptance criteria updated'); this plan was created at 2026-10-08T01:56:55Z, 33 s later; no v2 measurement exists yet. Record:

```json
{
  "id": "AC-BLS1-12",
  "statement": "Pilot v2 exit (migration method v2, specification branch): placement disagreements needing adjudication are at most 30% of a NEW frozen AC sample of at least 60 ACs drawn from specs outside the v1 population, mapped by 2 independent agents under a written placement principle; 0 established or observed rules lack a citing script-mode AC; and an independent blind reader scores at least 9 of 10 with 0 confident-wrong answers on a NEW probe set of 10 questions frozen before any v2 leaf revision",
  "verify": {
    "mode": "ai",
    "rubric": "Pass only if the v2 pilot assessment records all 5 numbers: (1) sample size >= 60 with its seed and freeze timestamp, (2) adjudicated disagreements / sample <= 30%, (3) count of established|observed rules with zero script-mode citing ACs == 0, (4) blind score >= 9/10, (5) confident-wrong == 0; and the probe-set v2 creation timestamp precedes the first baseline version written by plan v2; fail if any number is missing or any bar is moved after its measurement"
  }
}
```
