---
id: TASK-1406
type: task
role: plan
title: "lore fragments check never compares user-scope ~/.claude/rules/lore-*.md"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"fragments-check","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"bf5a9dfc-8c10-41c8-9f85-40ba60489f77"}
---

Split from #102 item 4. fragments-flow.ts:654 calls only detectProjectRulesDrift.

**Expected:** User-scope rules files are checked for drift too
**Actual:** Never checked
**Repro command:** `edit ~/.claude/rules/lore-user-09-behavior.md; lore fragments check`

Reported by: agent:session-c1ffea04
