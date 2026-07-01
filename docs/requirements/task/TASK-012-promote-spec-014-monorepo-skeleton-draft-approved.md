---
id: TASK-012
type: task
role: plan
title: "Promote SPEC-014 Monorepo Skeleton draft → approved"
status: archived
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track A · Task A1

Spec: 01KW6E4CG1 (Monorepo Skeleton, Bun workspaces, P1 layout)

Steps:
1. `lore get 01KW6E4CG1` — verify content matches landed code (commit b167ccc)
2. `lore set 01KW6E4CG1 --status in-review`
3. `lore approve 01KW6E4CG1`

Done when: `lore list --type spec --status approved` includes SPEC-014.
