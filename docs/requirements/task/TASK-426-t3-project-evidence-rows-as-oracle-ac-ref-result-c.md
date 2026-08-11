---
id: TASK-426
type: task
role: plan
title: "T3 — project evidence rows as (oracle, ac_ref, result, command, tail_bytes) in both prompt builders"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-082
plan: PLAN-082
---
Project a task's evidence rows into the assess prompt instead of letting a 10-row task doc
overflow its 4000-char budget and take the whole task body's content down with it.

## Required

`renderTaskEvidence` (`ai/assess-template.ts:173-189`) currently emits
`oracle=… command="…" result=… recorder=…` plus a 500-char tail clip. Change the row
projection to carry `(oracle, ac_ref, result, command, tail_bytes)`, keeping the clipped
tail ONLY for rows whose `ac_ref` is among the ACs under judgment.

`tail_bytes` is the point of the change: an empty tail must be VISIBLE as `tail_bytes=0`,
not inferable from an absent field. The measured failure this fixes is a judge that never
noticed both red-first rows showed nothing.

Both builders must be updated — v5 `buildAssessPrompt` task block (`:395-403`) and v6
`buildAssessPromptV6` (`:634-642`). AC-AEP-4 asserts they agree.

## ⛔ Frozen vocabulary (highest-risk coupling in this slice)

`truncated[]` entries MUST keep the exact form `task:<slug>`. `computeTaskTruncationRatio`
(`packages/core/src/assessment.ts:745-748`) keys off the `task:` prefix, and
`findUngroundedAbsenceDimensions` (`ai-provider-service.ts:200-218`) does a substring match
against these strings. The ratio drives the verdict-forcing branch at
`ai-provider-service.ts:1339-1341`. Changing the entry names silently changes verdicts.
AC-AEP-3 is the regression guard — do not weaken it into a "starts with task:" check.

## Verification discipline

Red first; record the red with a NON-EMPTY output_tail.
