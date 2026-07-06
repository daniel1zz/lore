---
id: TASK-051
type: task
role: plan
title: "T2 lore.tree.yaml blueprint authoring + arming + negative oracle"
status: archived
priority: high
phase: blueprint
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-012
plan: PLAN-012
---
AC-2 (SPEC-032 §3.2 REVISED v3: full-contract blueprint, task is LEAF, knowledge-under-adr modeled, knowledge-under-knowledge deliberately unmodeled). Author repo-root lore.tree.yaml per §3.2 YAML; verify lore status --check-tree exits 0 on live corpus; regression test asserting a deliberately mis-parented doc raises 'misplaced' (blueprint-independent contract check) AND a missing min=1 spec raises 'missing'. Anchors: lore.tree.yaml(new), packages/lore/tests/. Oracle: check-tree exit 0 live + negative tests green.
