---
id: TASK-1340
type: task
role: plan
title: "[Skill:implement] Core variable registry and expandTemplate"
status: archived
priority: critical
phase: "Phase 1: Core expander and fragment outlets"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
links:
  - {id: TASK-1339, type: blocks}
  - {id: TASK-1337, type: blocks}
  - {id: TASK-1334, type: blocks}
  - {id: TASK-1332, type: blocks}
---
Estimate: M
Approach: pure regex expander `/\{\{lore:([a-z][a-z0-9_]*)\}\}/g` (no templating library — plan Decisions Log); core owns mechanism + CAPTURE_TAIL_CHARS + LORE_AGENT_NAMES; lore owns the registry instance.
Source: spec D1-D3, D5, Module Boundary
Covers: AC-CV-1

AC:
- @lore/core exports ContextVariable, VariableSource, VariableOutlet, VarContext, expandTemplate, findPlaceholders, validateRegistry, CAPTURE_TAIL_CHARS, LORE_AGENT_NAMES (default barrel, no Node builtins).
- packages/lore/src/adapters/evidence-capture.ts imports CAPTURE_TAIL_CHARS from @lore/core (no second definition).
- packages/lore/src/service/context-variables-registry.ts exports LORE_CONTEXT_VARIABLES with capture_tail_chars, implementer_agent, reader_agent (code, all outlets); a unit assertion that validateRegistry(LORE_CONTEXT_VARIABLES) is ok.
- AC-CV-1 command exit 0; `bun run typecheck` exit 0.
