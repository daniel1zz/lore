---
id: TASK-1251
type: task
role: plan
title: "Closing a plan archives its open, unclaimed tasks directly, bypassing every lore done floor; the cascade is reported only in --json"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gate-bypass","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"475bd2dd-a0d8-4f30-8dd3-1340dde7a44d"}
---

Found by the pilot-v3 execution-branch excavation (agent Y, close-a-plan leaf): plan archival cascades open non-fresh-claimed child tasks to archived without the attested-pass or red-first floors, and the human-readable output omits the cascade despite a 'LOUD, never silent' code comment. A task's status may also be set draft->archived directly.

**Expected:** Plan closure either refuses while a child task has not cleared done's floors, or the cascade is printed in human output and counted as unproven
**Actual:** Open tasks become archived with no qualifying evidence; non-JSON output does not mention them

Reported by: agent:main-orchestrator
