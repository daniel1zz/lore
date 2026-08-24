---
id: TASK-812
type: task
role: plan
title: "[Skill:implement] export buildRetiredFeedbackUpstreamError and make the MCP handler consume it instead of restating the message"
status: archived
priority: medium
phase: "P2: Fix"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-143
plan: PLAN-143
---
Export buildRetiredFeedbackUpstreamError (currently module-private at report-issue-wiring.ts:172) and have adapters/mcp/tools.ts call it instead of holding its own copy of the message. Keep the lazy await import() — it exists to keep gh-runner/github-intake-port out of every tools.ts consumer's vitest graph, an unrelated and still-valid reason. Behaviour on all three shapes must be identical afterwards; this is an SSOT collapse, not a behaviour change.
