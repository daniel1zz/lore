---
id: TASK-552
type: task
role: plan
title: "evidence --ac gate only validates against the plan's direct governing spec, breaking AC traceability across an implements chain"
status: draft
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
---
A plan's governing tech-spec declares 'implements' links to two domain-overview specs. Tasks under that plan cite product-level ACs (AC-IC-*/AC-SC-*) owned by those domain specs, but the evidence gate resolves the valid AC id set from the direct parent spec only.
