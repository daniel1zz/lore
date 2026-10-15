---
id: TASK-987
type: task
role: plan
title: "An earlier reject or escalate judgment on a version blocks approval even after a later independent approve on the same version"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"review-gate","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b90bd275-80d5-4370-ba47-0e99a87ddff7"}
---

Measured 2026-10-10: adr-distribution-first-every-improvement-names-its-consumer and adr-product-skill-chain-derive-features-via-ost-execute-graded each got a fresh 'Decision: approve' from lore review, then lore approve exit 4 JUDGMENT_REJECTED / JUDGMENT_ESCALATED from an earlier judgment of the same version (an aborted parallel batch had reviewed them concurrently). Which judgment governs a version is not stated anywhere a caller can read.

**Expected:** The gate states which judgment governs (latest, or any blocking one) and the refusal names the governing judgment's id and time; if any blocking judgment wins, the review output says so before the caller tries approve
**Actual:** lore review prints approve, lore approve refuses on an older judgment without naming it

Reported by: agent:main-orchestrator
