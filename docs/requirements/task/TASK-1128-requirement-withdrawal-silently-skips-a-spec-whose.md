---
id: TASK-1128
type: task
role: plan
title: "Requirement withdrawal silently skips a spec whose acceptance criteria fail to parse, so its covering criterion does not block the withdrawal"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"product-baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"af714639-7d56-445f-b3e7-305b61bdfb4e"}
---

RequirementService.gatherDescendantAcRefs (packages/lore/src/service/requirement-service.ts:229-230) runs specAcceptanceCriteriaSchema.safeParse on each child spec's acceptance_criteria and does 'continue' on failure, with no message and no count. A spec whose stored criteria list does not validate therefore contributes no requirement_refs, and withdrawing a requirement it covers succeeds without --force. Found while fixing baseline leaf baseline-withdraw-a-product-requirement (BR-690..BR-693); not covered by #98 item (6), which is about depth, not parse failure.

**Expected:** A spec whose acceptance criteria cannot be parsed either refuses the withdrawal (fail loud, naming the spec) or is reported as not checked
**Actual:** The spec is skipped silently; the withdrawal succeeds with exit 0 even if that spec's criterion covers the requirement

Reported by: agent:blfix-C
