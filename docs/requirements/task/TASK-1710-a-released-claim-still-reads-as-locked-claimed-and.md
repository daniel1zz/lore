---
id: TASK-1710
type: task
role: plan
title: "A released claim still reads as locked (claimed), and another session's anchor edit was refused as held by it"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"claims","tags":["claim","anchor-gate"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b0dcc4cf-f577-45a1-8c9e-864440abb51c"}
---

Observed 2026-10-19 on task-the-main-ref-guard-refuses-checkout-of-main-integrate after its work landed (49278da8) and its implementer had released (v113). From the shared checkout: `lore release <task>` reported no active claim, while `lore get <task>` still printed 'Standing: record · locked (claimed)' and 'Last write: … claimed: agent:session-482f1e89 (session)'. In the same window another session (lore-81) reported that its edit of one of the task's anchors (packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts) was refused by the edit gate as held by the live claim of that task (holder agent:session-482f1e89); that refusal was paraphrased by its implementer, not captured verbatim, and a retry minutes later went through. Not reproducible now (the task is archived).

**Expected:** One claim-liveness predicate shared by release, the get renderer and the edit-time anchor gate: a released claim neither renders as 'locked (claimed)' nor makes the gate refuse another actor's edit of its anchors.
**Actual:** `lore release task-the-main-ref-guard-refuses-checkout-of-main-integrate` → 'Error: Validation failed on field 'extra.claim': Task has no active claim to release'; `lore get` → 'Standing: record · locked (claimed)'.

Reported by: agent:session-482f1e89
