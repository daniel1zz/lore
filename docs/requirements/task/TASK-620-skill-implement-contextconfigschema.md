---
id: TASK-620
type: task
role: plan
title: "[Skill:implement] contextConfigSchema + resolveMemoryFileBudgets — numbers SSOT in core config"
status: archived
priority: critical
phase: "Phase 1: Contracts & Content"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-618, type: blocks}
  - {id: TASK-615, type: blocks}
---
Estimate: S
Approach: per spec D1/D8 — new top-level `contextConfigSchema` in packages/core/src/config.ts: `context.memory_files.{filenames: ["CLAUDE.md"], root: {max_lines: 300, max_bytes: 30720}, module: {max_lines: 200, max_bytes: 16384}, enabled: true}` + `resolveMemoryFileBudgets(config)` mirroring resolveBootstrapInjectionBudgets.
Source: spec-project-claude-md-content-contract-governance-injected §Scope, §D1/D8
Dimensions: D-CODE
Scope-Alt: filenames array can defer to a hardcoded ["CLAUDE.md"] constant if schema churn is contentious
Covers: AC-CMC-1 (schema half)

AC:
- Given the paired RED suite, When implementation lands, Then `bunx vitest run packages/core/tests/config-context.test.ts` is GREEN with all cases matched (assert Test Files 1, no zero-match)
- Given a config.yaml without `context`, When resolveMemoryFileBudgets runs, Then it returns exactly the zod defaults (300/30720/200/16384, enabled true, filenames ["CLAUDE.md"])
- Given a config.yaml overriding `context.memory_files.root.max_lines: 500`, When resolved, Then only that field differs from defaults
- Given an unknown key under `context.memory_files`, When config loads, Then validation rejects it loudly (strict), exit surface unchanged for valid configs
- Given the R2 back-compat risk, When this task lands, Then CHANGELOG (or release receipt notes) documents the binary version floor for configs carrying `context.*` (older binaries reject them under strict parsing)
- Integration: `bun run typecheck` green; budget literals 30720/16384 appear in config.ts and tests ONLY (Invariant 1 grep)
