---
id: PLAN-081
type: plan
role: plan
title: "Land oracle-tier falsifiability: falsified coverage dimension, pipe refusal, unclaimed-oracle check"
status: archived
priority: high
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: SPEC-129
phases:
  - {name: "mechanisms"}
  - {name: "surfacing"}
---
## Goal\n\nLand the three mechanisms declared by the governing spec, report-only, with the 574-criterion back-catalogue grandfathered by the spec's written exemption.\n\n## Phases\n\n1. mechanisms — the three independent implementations (disjoint file anchors, dispatched in parallel).\n2. surfacing — consumes phase 1's derivation and check; depends on both.\n\n## Constraint\n\nEvery declared criterion must land with its OWN expected-fail control recorded against its own ac_ref. This plan is the dogfood instance: if its criteria close pass_unfalsified, the mechanism is reporting truthfully about itself.
