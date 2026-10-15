---
id: TASK-1343
type: task
role: plan
title: "No way to edit a plan phase's description after tasks reference it"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"corpus-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"5809b881-8db8-4c06-878e-f571751fca21"}
---

lore phase has add/list/rm/rename only; rename keeps the old description, rm refuses while tasks reference the phase, and lore set cannot move a task to another phase. After an S3 review changed a phase's scope, its description stays stating the rejected design, so the corpus lies with no correction path.

**Expected:** lore phase set <plan> <name> --description (or rename --description) updates the description and logs a version
**Actual:** Only workaround is a prose note in the plan body saying the phase description is superseded

Reported by: agent:session-ee1cedaf
