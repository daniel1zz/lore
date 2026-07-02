---
id: TASK-026
type: task
role: plan
title: "Implement lore assess end-to-end (AC-ASSESS-1..12)"
status: archived
priority: high
phase: implement
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-004
plan: PLAN-004
links:
  - {id: TASK-025, type: blocks}
---
Implement SPEC-026 §8 file touch list. Decisions D1-D10 ratified. Key: core/assessment.ts pure module; knowledgeExtraSchema assessment branch; AiConfigSchema.assess budgets; ai/ prompt template + ASSESS_PROMPT_VERSION; InMemoryAIProvider sequence mode; corpusService.getPlanBundle; aiProviderService.assessPlan with one corrective retry via sibling helper; CLI assess command (diff via git subprocess / --diff-file seam); MCP lore_assess; sub_type consumer sites.
