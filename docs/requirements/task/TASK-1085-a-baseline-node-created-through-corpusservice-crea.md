---
id: TASK-1085
type: task
role: plan
title: "A baseline node created through CorpusService.create accepts a whitespace-only label (BR-613)"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"edeb2be6-dcb0-49e4-bdda-d88d6a7a0f3e"}
---

Found by baseline-field-bounds.test.ts (AC-P0C-2).

**Expected:** A whitespace-only label is refused with VALIDATION_ERROR on every write path, as RuleService.addNode does (rule-service.ts:460)
**Actual:** packages/core/src/baseline.ts:163 label: z.string().min(1) admits '   '; the doc is created

Reported by: agent:main-orchestrator
