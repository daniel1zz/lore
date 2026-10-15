---
id: TASK-1229
type: task
role: plan
title: "[Skill:implement] Criterion exemptions: reason, expiry, actor, 10% cap with CAS"
status: archived
priority: critical
phase: "Phase 3: Citation gate"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1215, type: blocks}
  - {id: TASK-1225, type: blocks}
---
Estimate: M
Approach: ac_exemptions rows (migration-014); grant = insert under a CAS'd counter in one transaction, like rule-id allocation; lore ac exempt <spec> <ac> --reason --expires --by; status counts per branch
Source: spec C4 exemptions; security review
Covers: AC-BLS2-10
AC:
- Before editing: record expected-fail of AC-BLS2-10's command on THIS task
- bunx vitest run packages/lore/tests/unit/service/ac-exempt.test.ts passes
