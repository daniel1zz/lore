---
id: TASK-1411
type: task
role: plan
title: "lore setup --project overwrites an existing core.hooksPath and uninstall never restores it"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"setup-project","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ac2ac256-807f-4f4f-834d-96bb02025e7d"}
---

Split from #101 item 5. setup-project-flow.ts:1252-1259 overwrites; uninstall never touches hooksPath.

**Expected:** The previous hooksPath is kept or restored on uninstall
**Actual:** It is lost
**Repro command:** `git config core.hooksPath .husky; lore setup --project --yes; lore setup --project --uninstall`

Reported by: agent:session-c1ffea04
