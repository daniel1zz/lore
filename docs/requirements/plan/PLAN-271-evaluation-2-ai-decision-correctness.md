---
id: PLAN-271
type: plan
role: plan
title: "Evaluation 2: AI decision correctness"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-25
tags: [evaluation, metrics]
parent: SPEC-239
phases:
  - {name: "AI decisions", description: "O2: outcome labels, judge scores, override reasons, weekly human audit"}
---
## Goal

Answer question A (AI decision quality, OST O2): outcome labels from machine after-events, Brier / reliability bins / AUC per judge, override shares, mandatory override reasons (#407), and the in-session human audit (user D10: no queue, one sampled question riding on an ask a person already answers) with Cohen's kappa. Second of five evaluation plans; spec `spec-ai-decision-correctness-outcome-attribution-and-audit`.

## Preconditions

- Plan `plan-evaluation-1-experiments-and-honest-metric-envelope`: the envelope task and the origin task landed; the AI-decisions experiment recorded its branches (O2-S1, O2-S2, O2-S3). The pre-registered branch table lives in that plan's Decisions Log and binds this plan.

## Tasks

| Task | Covers |
|---|---|
| Outcome labels, Brier, reliability bins and guard figures | AC-AD-1, AC-AD-2, AC-AD-8, AC-AD-9 |
| An override needs a reason (#407) | AC-AD-4 |
| Audit sample and the in-session audit question | AC-AD-5, AC-AD-6 |
| Judge-versus-human agreement and audit completion | AC-AD-7, AC-AD-10 |

## After landing (main agent)

`lore done`, `lore verify <plan>`, `lore rule apply spec-ai-decision-correctness-outcome-attribution-and-audit`, `lore assess`.

## Decisions Log

- #408 is not bound: its premise was wrong (corrected 2026-10-25). The 62 overridden task rejects were deterministic `evidence_completeness` pre-check verdicts, not AI judgments; BR-1422 keeps such verdicts out of every AI figure and reports them as a count.
- The audit tasks hold with no human present: nothing is queued, kappa stays insufficient until verdicts accrue, and completion below 50% for 4 weeks stops the audit (BR-1410).
- Judge AUC is not shipped (S3 PS2); plan 1's AI-decisions experiment measures it once.
