---
id: TASK-886
type: task
role: plan
title: "KNOWLEDGE_SUB_TYPES has three hand-written prose copies, all incomplete, and the test guarding the error message is an alternation that any single member satisfies"
status: draft
priority: medium
created: 2026-08-26
updated: 2026-08-26
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"ssot-duplication","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2c1ab3e8-4821-49ac-ae85-ea5c8e2ea72c"}
---

packages/core/src/types.ts:222 declares KNOWLEDGE_SUB_TYPES with 9 members (ideation, retro, research, reference, assessment, prompt, skill, handoff, uat) and knowledgeSubTypeSchema derives from it, so validation itself is correct. But the human-readable list is re-typed by hand in three more places and every copy is stale: packages/core/src/schemas.ts:701 (the superRefine message a user actually sees) lists 8 and omits 'uat'; packages/lore/src/adapters/cli/commands/create.ts:6 lists 4; assets/governance/corpus-workflow.md:22 lists 4 -- and that last one is a SHIPPED asset, embedded in the binary and installed into every consumer project by 'lore setup', so a fresh install is told 5 of the 9 sub-types do not exist. The guard is worse than absent: packages/lore/tests/unit/adapters/cli-create.bun.test.ts:400 and :420 assert toMatch(/ideation|retro|research|reference/), an alternation that goes green when ANY ONE of four words appears anywhere in stderr, so it cannot distinguish the current 8-member message from the correct 9-member one, nor from a message listing only 'ideation'. 7 uat knowledge docs already exist in this corpus, so the omission is not theoretical. The mechanism root is that a closed enum with a user-facing rendering has no single derivation point: the message should be built from KNOWLEDGE_SUB_TYPES.join('|') and the doc/asset copies should either be generated or covered by an equality assertion against the enum, not by a substring matcher.

**Expected:** Every user-facing rendering of the knowledge sub-type set is derived from KNOWLEDGE_SUB_TYPES, so adding a 10th member updates the CLI error message, the create.ts header, and the shipped corpus-workflow.md asset with no hand edits; and the test asserts set EQUALITY against the enum rather than matching any one member.
**Actual:** Four independent hand-maintained renderings disagree with the 9-member enum (8 / 4 / 4 members), the shipped governance asset is one of them, and the only test over the message is an alternation regex with zero discriminating power.
**Repro command:** `grep -n 'ideation|retro' packages/core/src/schemas.ts packages/lore/src/adapters/cli/commands/create.ts assets/governance/corpus-workflow.md packages/lore/tests/unit/adapters/cli-create.bun.test.ts; sed -n '222,232p' packages/core/src/types.ts`

Reported by: agent:main-orchestrator
