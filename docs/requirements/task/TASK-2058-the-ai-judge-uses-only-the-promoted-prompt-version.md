---
id: TASK-2058
type: task
role: plan
title: "The AI judge uses only the promoted prompt version"
status: draft
priority: medium
phase: "Calibration labels"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-260
plan: PLAN-260
---
## Objective
Make the AI judge use only the promoted version (BR-1462): template selection in ai-provider-service.ts reads the latest passing promotion (`REVIEW_TEMPLATES[promoted.version]`); REVIEW_PROMPT_VERSION no longer chooses it; no promotion means judging refuses with exit 4 and writes nothing.

Precondition step (before claiming, main agent, shared checkout, after the gate task landed): `lore calibration promote <the version REVIEW_PROMPT_VERSION names at that time>`. If it exits 4 (outcome fail or not_measurable), this task is not claimed: pre-registered stop (RJ-D4), the plan stops and the spec is re-reviewed; reviews keep working meanwhile because this switch has not landed; no unmeasured promotion row is seeded and no constant fallback is added.

Spec: spec-retired-judge-instruction-versions-stay-in-calibration (BR-1462).

Covers: AC-RJ-3

## Must resolve before evidence

1. spec-retired-judge-instruction-versions-stay-in-calibration (approved by override; open review finding): the calibration gate covers only the review-kind judge. Staleness (`STALENESS_PROMPT_VERSION`, packages/lore/src/ai/staleness-template.ts) and milestone-review (`MILESTONE_REVIEW_PROMPT_VERSION`, packages/lore/src/ai/milestone-review-template.ts) prompt versions are still chosen by a code constant with no gate. Before plan-retired-judge-versions-labelled-in-calibration closes, either extend the promotion gate to those kinds (a spec revision through review and approval: their outcome labels, holdout and bar), or file a follow-up issue that names this mechanism (a prompt version of every judge kind becomes current only by passing a calibration gate) and link its number here.
