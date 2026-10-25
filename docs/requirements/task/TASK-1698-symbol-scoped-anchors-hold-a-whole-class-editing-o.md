---
id: TASK-1698
type: task
role: plan
title: "Symbol-scoped anchors hold a whole class: editing one method of TaskWorkflowService holds every method of it"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"anchors","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9d1e083b-d419-4ecc-93e4-d874b882b5dc"}
---

The edit-time anchor gate and the own-diff judgment split a file into TOP-LEVEL symbols only (assets/hooks/lib/top-level-symbols.mjs, packages/core/src/top-level-symbols.ts). In a class-based service the class is the only top-level symbol, so the first edit to any method auto-declares path#ClassName, which holds every method. Observed 2026-10-20: task-d3b-b-park-releases-a-hold-anchors-follow-moved-files gained the anchor packages/lore/src/service/task-workflow-service.ts#TaskWorkflowService (a class of several thousand lines) through the edit hook's auto-declare, so any other task editing any TaskWorkflowService method collides with it. For lore's own service layer, symbol-scoped holds therefore give no finer granularity than whole-file holds.

**Expected:** Editing one method holds only that method (path#Class.method), so two tasks changing different methods of one class do not collide at edit time, claim time or integrate.
**Actual:** Editing one method auto-declares path#Class, which collides with every other method edit in the class, the same as a whole-file anchor.
**Repro command:** `lore get task-d3b-b-park-releases-a-hold-anchors-follow-moved-files --json  # extra.file_anchors includes packages/lore/src/service/task-workflow-service.ts#TaskWorkflowService`

Reported by: agent:session-c1ffea04
