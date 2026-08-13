---
id: TASK-686
type: task
role: plan
title: "Finish the drift-row rename: spec_id and spec_status still carry spec-flavoured names on knowledge rows"
status: archived
priority: medium
phase: "reachable-facts"
created: 2026-08-11
updated: 2026-08-12
tags: []
parent: PLAN-126
plan: PLAN-126
---
Residual the M2 implementer reported rather than hid. My spec's declared field contract renamed only DriftRow.spec_slug -> doc_slug (+ doc_type); spec_id and spec_status kept spec-flavoured names, so a consumer keying on either can still read a KNOWLEDGE breach as a spec's. The implementer implemented exactly as specified and made the residual grep-visible in code. Rename both to doc_id/doc_status with every consumer updated in the SAME change — the two spellings must never coexist — and delete the residual note now that it is no longer true. The gap between 'AC passed' and 'goal met' here was the AC designer's, not the implementer's.
