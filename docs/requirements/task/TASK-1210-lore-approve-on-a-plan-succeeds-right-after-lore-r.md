---
id: TASK-1210
type: task
role: plan
title: "lore approve on a plan succeeds right after lore review returned reject for the same version — a rejecting judgment is ignored for types outside judgment_required_types"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"review-gate","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2b3374bd-664b-41bb-94cb-78ea1f5a7c9d"}
---

Measured on plan-baseline-slice-2a: lore review -> Decision: reject (0.72, six concrete findings); lore approve -> 'Approved ... (v11)'. For an ADR the same sequence is refused with JUDGMENT_REJECTED. A reject that does not block is a verdict that does not bind; the review queue then certifies plans its own judge rejected.

**Expected:** A rejecting (or escalating) judgment for the current version blocks lore approve for every doc type, as escalate already does
**Actual:** Plan approved one second after a reject judgment on the same version

Reported by: agent:main-orchestrator
