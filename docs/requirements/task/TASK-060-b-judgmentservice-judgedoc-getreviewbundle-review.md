---
id: TASK-060
type: task
role: plan
title: "B JudgmentService + judgeDoc + getReviewBundle + review-template"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-015
plan: PLAN-015
---
SPEC-034 §4/§5: service/judgment-service.ts (record/latestFor/listFor/recordCalibration version-pinned/computeCalibrationStats via queryCalibrationWindow+wilsonLowerBound), ai/review-template.ts (REVIEW_TEMPLATES version-keyed registry, REVIEW_PROMPT_VERSION), AIProviderService.judgeDoc (mirror assessPlan: budgets ai.review.*, extractAssessmentJson reuse, ONE corrective retry), core runDeterministicChecks pure fn (schema/parent_contract/tree_position/link_integrity/evidence_completeness; blueprint absent→skipped never silent), CorpusService.getReviewBundle (getPlanBundle precedent), app.ts wiring, ai.ts budgets, config verify_since placeholder NOT here. DEPENDS ON A. Anchors: service/, ai/, packages/core/src/review-checks.ts, app.ts.
