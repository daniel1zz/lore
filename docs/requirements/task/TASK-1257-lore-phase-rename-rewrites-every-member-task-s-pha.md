---
id: TASK-1257
type: task
role: plan
title: "lore phase rename rewrites every member task's phase (archived ones included) with no version or audit row on the task"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"audit-gap","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6926fd1d-f0f7-47f8-a59d-0660938fd65b"}
---

phase-service.ts:318-331 updates tasks via bare store.update with no version/audit and no status filter; only the plan logs a version. The header (phase-service.ts:11-13) promises phase-set mutations are visible in lore log/diff. Found by probe v3 Q8.

**Expected:** A task whose phase changes gets a version row (or archived tasks are left untouched), so a task's lore log explains its current phase
**Actual:** Archived task stays at v4 while its phase changes P2 -> P2b; live task's log tops out at 'Evidence added' after the rename

Reported by: agent:main-orchestrator
