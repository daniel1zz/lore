---
id: PLAN-260
type: plan
role: plan
title: "Judge prompt versions become current only through a calibration gate"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: [evaluation, calibration]
parent: SPEC-248
phases:
  - {name: "Calibration labels", description: "O2-S3: retired judge versions labelled in calibration statistics"}
---
## Goal

Implement spec-retired-judge-instruction-versions-stay-in-calibration (D20, S3 round 2): a judge prompt version becomes current only by passing a replay calibration gate (AUC DeLong lower bound >= 0.65 per measured document type); the judge uses only the promoted version; history stays labelled by version (v2 retired).

## Tasks

| Task | Covers |
|---|---|
| Judge promotion gate and version-labelled calibration groups | AC-RJ-1, AC-RJ-2 |
| The AI judge uses only the promoted prompt version (precondition: the then-current version passes promotion) | AC-RJ-3 |

Order (task-level blocks): S-B's outcome-label task -> gate task -> switch task.

## After landing (main agent)

lore integrate; lore done; lore verify <plan>; lore rule apply spec-retired-judge-instruction-versions-stay-in-calibration; lore assess.

## Decisions Log

- Pre-registered: if the version current when the switch task starts fails promotion, the switch task is not claimed and the spec is re-reviewed (RJ-D4); no unmeasured promotion is seeded.
- #414's v9 (governance plan) becomes current only through this gate once both land; the cross-initiative task link is owned by the governance drafter.
- Anchor overlap with the origin task of plan-evaluation-1 (judgment-service.ts, store migrations) and with the #414 review-template change is ordered by task-level links the governance drafter owns (S3 round 2, plan 6).
