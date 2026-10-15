---
id: TASK-1176
type: task
role: plan
title: "lore delete promises 'recoverable for 30 days' but no command un-deletes a document"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"doc-code-contradiction","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"15cb9ca1-127f-4085-a038-43279103171d"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** Either an undelete path exists, or the help text stops promising recovery
**Actual:** lore restore adds a version to a deleted doc but leaves deleted_at set; lore get still returns the deleted doc and its text output does not show it is deleted

Reported by: agent:main-orchestrator
