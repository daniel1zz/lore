---
id: TASK-1679
type: task
role: plan
title: "A racing claim is written first and rolled back on conflict, so two racers can both lose"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"claims","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"59305a3c-d592-43df-806d-e8b1f2862d5f"}
---

BR-139: a claim is written, the conflict check runs again, and the claim is rolled back if another fresh claim appeared; two concurrent claimants can both be rolled back. The claim-a-task leaf records this as an accepted residual. The conflict check and the write are not one atomic step, which the multi-session target (many concurrent sessions) makes a recurring loss.

**Expected:** the conflict check and the claim write happen in one store transaction (compare-and-set on the task's claim), so exactly one of two racers wins and the other is refused naming it
**Actual:** BR-139: a double rollback where neither racing claim survives is accepted as the residual

Reported by: agent:session-a979eecd
