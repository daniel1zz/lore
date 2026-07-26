---
id: TASK-188
type: task
role: plan
title: "T2 — /execution page: route, nav, plan selector, four read-only panels (AC-077-1/2/3/6)"
status: archived
priority: high
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-041
plan: PLAN-041
links:
  - {id: TASK-189, type: blocks}
---
Implement SPEC-077 S1+S2: TanStack route /execution + nav entry (Issues-nav pattern); plan selector synced to ?plan search param, defaulting to most recently active plan; useSuspenseQuery fetches GET /api/ready/:plan and GET /api/phase-status/:plan per the spec-pinned shapes (develop against pinned shape; do not wait on T1). Pure-props components: ReadyTaskList (tri-state claim badge with TTL countdown = claim_ttl_minutes - age_minutes clamped 0; row click -> /docs/$id), SessionsPanel, AnchorConflictsPanel, PhaseProgressPanel (a/b attested counts, checklist states, dropped names, vacuous badge, verbatim trust labels, empty states). Countdown ticks client-side, no polling. Telemetry: /execution gets route_id attribution via existing use-route-telemetry — add the AC-077-6 case to its existing unit test. Oracles: AC-077-1/2/3/6 commands.
