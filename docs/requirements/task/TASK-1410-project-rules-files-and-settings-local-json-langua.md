---
id: TASK-1410
type: task
role: plan
title: "Project rules files and settings.local.json language written by setup --project survive uninstall"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"setup-project","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4bc76e2a-e8b7-4150-bd06-31643524d349"}
---

Split from #101 item 7. setup.ts:658-680 writes rules files outside the ledger; setup-project-uninstall.ts never removes them.

**Expected:** Uninstall removes everything install wrote
**Actual:** Rules files and the language setting remain
**Repro command:** `lore setup --project --yes; lore setup --project --uninstall; ls .claude/rules`

Reported by: agent:session-c1ffea04
