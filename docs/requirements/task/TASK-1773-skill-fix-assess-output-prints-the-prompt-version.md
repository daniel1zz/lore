---
id: TASK-1773
type: task
role: plan
title: "[Skill:fix] Assess output prints the prompt version as vv5 on CLI and MCP"
status: approved
priority: low
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (found by DC2-10, 2026-10-19): DC2-10 fixed the doubled `vv` in review output, but `packages/lore/src/adapters/cli/assess-render.ts:312` and `packages/lore/src/adapters/mcp/assess-render.ts:130` still print `prompt v${prompt_version}` while the stored version already carries the `v` (e.g. `v5`), so assess output reads `prompt vv5`.
Approach: both renderers print the stored prompt_version verbatim, as review-render does; one shared formatter if review-render's can be reused.
AC: an assessment rendered by both the CLI and MCP renderers with prompt_version `v6` contains `prompt v6` and never `vv`. Runner-produced red.
