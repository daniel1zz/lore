---
id: TASK-003
type: task
role: plan
title: "Draft SPEC: Dashboard write UI"
status: archived
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track B · Task B4

Source: SPEC-015 (Dashboard) is read-only v1. SPEC-016 cookie auth bootstrap already paves the way (sessions table + lore dashboard command).

Goal: Stub SPEC for write-capable dashboard. Resolve:

- Scope: create / edit content / change status / link mgmt — all four, or subset for v2?
- Optimistic concurrency: how to surface stale-version conflicts (exit code 5 in CLI; what UX in browser?)
- Editor: textarea, code mirror, or MDX-aware?
- Permissions model: cookie session → which roles can approve?
- Telemetry parity with CLI write ops

Deliverable: spec-dashboard-write-ui in draft, with explicit v2-vs-v3 scope split.
