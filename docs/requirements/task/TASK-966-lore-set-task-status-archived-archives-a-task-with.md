---
id: TASK-966
type: task
role: plan
title: "lore set <task> --status archived archives a task without any lore done floor (residual of issue 47)"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gate-bypass","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"35d58d31-632d-4ec8-b6c3-6db56ff9fe11"}
---

Issue 47's body names two bypasses: the plan-close cascade and setting a task's status straight to archived. The fix spec for 47 (plan-close cascade checks done's floors) covers only the first. Baseline rule BR-212 records the second: setting a task's status directly to archived applies none of the archival requirements, allowed straight from draft. CorpusService.set has no task-archived branch that consults the attested-pass, red-first, no-new-tests or unfiltered-test-file floors; CLI set.ts, MCP lore_set and HTTP PATCH all reach it.

**Expected:** Setting a task's status to archived either goes through the same floors as lore done (same verdict, same exit code) or is refused naming lore done
**Actual:** lore set <task> --status archived exits 0 for a task with no evidence; the task leaves every ready set

Reported by: agent:session-f0196b68
