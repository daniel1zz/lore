---
id: TASK-2037
type: task
role: plan
title: "R2 attach the named test file's context: spec refs always, capped header for the upstream repo itself"
status: archived
priority: medium
phase: "R"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-273
plan: PLAN-273
---
Covers: AC-RI-3, AC-RI-4, AC-RI-6. Spec section Context attachment and D3, D6, D8: leading-comment boundary moved from scripts/test-declared-inputs.ts into packages/lore/src/service/leading-comment.ts (script imports it; keep scripts/tests/changed-tests-declared-inputs.test.ts green), parseGithubRemote (host github.com, ssh/https, .git stripped, case-insensitive), redactHomeInText, symlink guard, 'nothing to attach from <path>'. Base: main after R1 landed.
