---
id: TASK-001
type: task
role: plan
title: "Draft SPEC: default --no-ai for agent / MCP paths"
status: archived
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track B · Task B6

Source: Dogfood session 2026-06-30 — when the agent invoking lore IS claude (via main loop, subagent, or MCP), the default AI path (SPEC-017) spawns claude CLI → claude-on-claude nesting. Adds 3-30s latency and stdio churn for zero benefit.

Symptom: I had to add --no-ai to every single lore create plan/task call this session.

Goal: SPEC follow-up to SPEC-017 making AI opt-IN (not opt-out) when the caller is itself an LLM. Resolve:

- Detection: env var LORE_AI_DEFAULT=off, or auto-detect via CLAUDECODE / CLAUDE_AGENT_TYPE / process.env.MCP_TRANSPORT?
- CLI path: humans typing `lore create` still want AI default-on
- MCP path: lore_create tool default-off (caller already drives AI)
- HTTP path: configurable per-key in agent table
- Telemetry: track ai_default_source (env|cli|mcp|http) on every ai.generation event

Deliverable: spec-default-no-ai-for-agents in draft, updating SPEC-017 §3 config matrix.
