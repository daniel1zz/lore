---
id: TASK-626
type: task
role: plan
title: "lore setup MCP-add step is non-idempotent — 'already exists' exits 1 and fails the whole converge"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PRD-001
---
Repro: run lore setup --yes twice on a machine where the lore MCP server is already registered. Second run: all assets up-to-date, but the MCP step runs 'claude mcp add -s user lore -- <bin> --mcp-server', which exits 1 with 'MCP server lore already exists in user config', and setup propagates exit 1 despite a fully successful converge. Expected: already-exists is the DESIRED end state and must be treated as success/skip (idempotency, SPEC-076 I2 spirit). Fix direction: detect the already-exists case (parse stderr or pre-check 'claude mcp list') and report the step as skipped, exit 0; a genuinely different failure still exits 1. Observed 2026-07-26 during SPEC-085 converge.
