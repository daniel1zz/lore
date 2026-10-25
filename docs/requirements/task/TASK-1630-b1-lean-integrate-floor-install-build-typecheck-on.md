---
id: TASK-1630
type: task
role: plan
title: "B1 lean integrate floor: install/build/typecheck only; other checks to the plan-close chain"
status: archived
priority: medium
phase: "B"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. Reference: GitHub merge queue, Nx affected. One declaration of FLOOR_STEPS and PLAN_CLOSE_STEPS read by run-chain.ts (--floor, --plan-close, --list). Own-diff stays in lore integrate before the floor command. Leave .lore/config.yaml floor_command as is (it calls check:floor).
