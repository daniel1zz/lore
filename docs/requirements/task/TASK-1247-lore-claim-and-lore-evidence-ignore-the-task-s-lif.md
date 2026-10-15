---
id: TASK-1247
type: task
role: plan
title: "lore claim and lore evidence ignore the task's lifecycle status: archived, blocked and retracted tasks can be claimed and receive evidence"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"state-guard","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a59aac37-d09a-4845-ba90-acbc50fa5ea1"}
---

Found by pilot-v3 excavation (agent X, claim-a-task / record-evidence leaves): claim checks only the document type; evidence checks neither status nor holder.

**Expected:** Claiming or recording evidence on an archived or retracted task is refused (or explicitly allowed with a stated reason), and a blocked task's claim names the blocker
**Actual:** claim on an archived task succeeds

Reported by: agent:main-orchestrator
