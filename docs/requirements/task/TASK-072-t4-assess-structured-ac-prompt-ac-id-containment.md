---
id: TASK-072
type: task
role: plan
title: "T4 assess: structured-AC prompt + ac_id containment"
status: draft
priority: high
phase: assess-projection
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-018
plan: PLAN-018
links:
  - {id: TASK-070, type: blocks}
---
Objective: assess judge consumes the declared AC set (SPEC-026 integration).
Spec: SPEC-038 §5, §7 D5. ACs covered: AC-ACODE-4, AC-ACODE-5.
Work:
1. packages/lore/src/ai/assess-template.ts — when bundle.spec has structured ACs: replace the "Spec Acceptance Criteria (verbatim)" section with a deterministic AC table (id | statement | verify mode | per-AC coverage from computeAcCoverage over bundle.tasks); instruct judge: ac_id MUST come from the declared set, script-mode ACs are judged primarily on evidence records. No structured ACs → verbatim fallback (byte-identical current behavior). ASSESS_PROMPT_VERSION 3→4.
2. packages/lore/src/service/ai-provider-service.ts — named fn validateAcIdContainment(output, declaredIds) runs AFTER llmAssessmentOutputSchema parse succeeds; violation → err(VALIDATION_ERROR) with offending ids listed; does NOT consume the corrective retry (retry stays JSON-parse/schema-only); no knowledge doc created.
3. Tests: InMemoryAIProvider sequence mode drives (a) valid structured response → doc created, prompt contains AC table + version 4; (b) out-of-set ac_id → err, no doc; (c) legacy spec (no structured ACs) → verbatim section unchanged (REGRESSION snapshot).
Oracle: bun run typecheck + bunx vitest run (affected).
Depends: T1 (computeAcCoverage, schema). File anchors: packages/lore/src/ai/assess-template.ts, packages/lore/src/service/ai-provider-service.ts, matching tests. No overlap with T5 anchors.
