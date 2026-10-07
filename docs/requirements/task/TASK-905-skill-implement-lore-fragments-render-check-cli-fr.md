---
id: TASK-905
type: task
role: plan
title: "[Skill:implement] lore fragments render|check CLI + fragments-flow + project-pointers-flow"
status: archived
priority: critical
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-910, type: blocks}
---
Estimate: M
Approach: per spec D6, D7, D12, D13 — new citty command `lore fragments` (pattern: adapters/cli/commands/governance.ts — bootstrap-stage, no loader.ts/bun:sqlite, resolveAssetsRoot) with `render --outlet <id> [--agent-type] [--cwd] [--explain]` and `check [--json]`. runFragmentsRender emits hook JSON `{hookSpecificOutput:{hookEventName, additionalContext}}`; on error emits a ≤400-char banner carrying the error code (exit 0 for hook outlets). session-start outlet appends the D7 stale notice (`lore:stale-managed-context`) + changed bodies within remaining budget else ids (`+N more`). runFragmentsCheck enumerates every outlet × agent type (assets/agents/*.md names + 'subagent:*'), checks caps, Z1 drift vs fresh render, override refusals, and Claude Code `language` drift (D3), exit non-zero on any. project-pointers-flow: NEW flow reproducing subagent-context.mjs buildProjectContext (line ~34) behaviour, exposed as `lore fragments pointers --cwd <p>`, output ≤ POINTER_CEILING truncated at a line boundary. Do NOT edit assets/hooks/subagent-context.mjs (hooks-subagent task deletes the old function).
Source: spec D3, D6, D7, D12, D13; assets/hooks/subagent-context.mjs buildProjectContext
Dimensions: D-FUNC, D-CODE
Scope-Alt: --explain may be minimal (id/layer/chars).
Covers: AC-CF-4 (and the render/check halves of AC-CF-12, AC-CF-18)

AC:
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-4'` → ≥1 pass, 0 fail.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
