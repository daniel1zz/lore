---
id: TASK-1169
type: task
role: plan
title: "lore pending --type task always returns an empty list and the help does not say tasks are excluded"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"cli-usage","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"16b88aca-19a2-492c-8d3f-461cc7b96e13"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** Either tasks with draft status are listed, or --type rejects/notes task
**Actual:** lore pending --type task -> empty, exit 0, with draft tasks present

Reported by: agent:main-orchestrator
