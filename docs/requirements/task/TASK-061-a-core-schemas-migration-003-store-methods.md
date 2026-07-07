---
id: TASK-061
type: task
role: plan
title: "A core schemas + migration-003 + store methods"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-015
plan: PLAN-015
---
SPEC-034 §2/§3: packages/core/src/review-judgment.ts (REVIEW_DECISIONS, judgeIdentitySchema exact tuple, checkResultSchema pass/fail/skipped, reviewJudgmentSchema + superRefine escalate→blocking_questions nonempty, LLM-output subset schema), calibration.ts (calibrationRecordSchema + wilsonLowerBound pure fn + direct unit tests), audit-actor.ts (formatJudgeActor/parseAuditActor codec). migration-003.ts: review_judgments + calibration_records DDL + indexes per spec. StoreInterface +5: insertJudgment, findJudgments(docId), latestJudgment(docId), insertCalibrationRecord, queryCalibrationWindow(docType?, promptVersion?, limit) — 3 impls (sqlite/turso/in-memory). Anchors: packages/core/src/*, packages/lore/src/store/*.
