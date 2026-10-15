---
id: TASK-1084
type: task
role: plan
title: "lore baseline add with an unrecognised --tree value creates a business node instead of refusing (BR-613)"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d2e6a804-6575-4ffc-a9b8-a93f80d0198b"}
---

Found by baseline-field-bounds.test.ts (AC-P0C-2).

**Expected:** A tree outside {business, architecture} is refused, as CorpusService.create does
**Actual:** RuleService.addNode with tree 'marketing' succeeds as a business node: isNodeOfTree (packages/core/src/baseline.ts:67) treats every value other than 'architecture' as business

Reported by: agent:main-orchestrator
