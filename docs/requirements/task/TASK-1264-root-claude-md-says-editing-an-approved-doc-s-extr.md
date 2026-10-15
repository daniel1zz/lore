---
id: TASK-1264
type: task
role: plan
title: "Root CLAUDE.md says editing an approved doc's extra demotes it to draft; CorpusService.set demotes only on content/title change"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"doc-code-contradiction","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"61f862c5-b031-4c43-badc-8b2d80403aeb"}
---

CLAUDE.md Document Lifecycle: 'Editing an approved doc resets it to draft automatically — content/title AND extra'. corpus-service.ts:2037-2061 computes contentOrTitleChanged = content!==undefined || title!==undefined and passes only that to resolveStatusAfterContractEdit. Found by the pilot-v2 citation pass (baseline rules BR-80/BR-81 match code).

**Expected:** CLAUDE.md and code agree on whether an extra-only edit (priority, tags, kind, other extra keys) demotes an approved doc
**Actual:** Prose says extra edits demote; code keeps an approved doc approved on extra-only patches (e.g. kind change), so agents following CLAUDE.md expect a demotion that never happens

Reported by: agent:main-orchestrator
