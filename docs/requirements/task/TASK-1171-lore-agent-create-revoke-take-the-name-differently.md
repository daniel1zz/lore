---
id: TASK-1171
type: task
role: plan
title: "lore agent create/revoke take the name differently and return exit 1 for a duplicate name"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"cli-usage","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d0df8817-9f92-487b-b9c8-fa05ff0df952"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** Consistent argument style and the validation exit code (4) for a duplicate
**Actual:** agent create uses --name, agent revoke a positional; a duplicate name exits 1 while other validation errors exit 4

Reported by: agent:main-orchestrator
