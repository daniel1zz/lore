---
id: TASK-192
type: task
role: plan
title: "Decide + implement NewDocModal gated-type authoring (spec creation via dashboard modal is structurally gate-rejected)"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: KN-080, type: implements}
---
Open product question flagged in knowledge-pre-existing-e2e-seed-gate-debt-dashboard-spec-create (2026-07-22), made actionable at SPEC-075 closure: NewDocModal collects type/title/parent but NO content, so every spec created through it is denied by the spec-create gate (hasSkeleton). Decide under a SPEC-022/SPEC-052 lens: (a) modal seeds a gate-conformant template skeleton for gated types, (b) spec authoring is deliberately CLI/skill-only and the modal should hide/disable type=spec with an explanatory hint, or (c) full content field in the modal. Whichever is chosen: AC (1) creating a spec via the dashboard either succeeds gate-conformantly or is impossible-by-design with visible explanation — no silent 4xx; (2) component test covers the chosen behavior; (3) e2e write-flow stays green.
