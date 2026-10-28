---
id: PLAN-249
type: plan
role: plan
title: "AC-RL-2 moves off the MCP test file"
status: archived
priority: medium
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: SPEC-259
phases:
  - {name: "T", description: "Move AC-RL-2's test"}
---
# AC-RL-2 moves off the MCP test file

## Goal

The MCP server removal (spec-remove-the-lore-mcp-server) deletes packages/lore/tests/unit/adapters/mcp-github-filing.test.ts. Move the AC-RL-2 formatter cases to packages/lore/tests/unit/adapters/report-issue-repeat-warning.test.ts and delete them from the MCP file, so AC-RL-2 survives the deletion.

## Tasks

- T1: the move. AC-RL-2.

## After landing

lore verify; lore done; tell session lore-22 that AC-RL-2 is re-pointed.
