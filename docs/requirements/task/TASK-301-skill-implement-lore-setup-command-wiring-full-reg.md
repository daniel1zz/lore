---
id: TASK-301
type: task
role: plan
title: "[Skill:implement] lore setup command + wiring + full regression (AC-046-E)"
status: archived
priority: critical
phase: "cli-adapter"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-300, type: blocks}
---
Estimate: M
Approach: Implement `adapters/cli/commands/setup.ts` (thin citty adapter: flag parsing, targetDir resolution, service construction with real ports, receipt render) + register the command in the CLI loader/index + any app.ts wiring for the init-service path ProjectSetupService needs. Then run the full regression (AC-046-E). This is the integration/wiring task.
Source: SPEC-046 Design (commands/setup.ts thin adapter; targetDir resolution `--claude-dir` > $CLAUDE_CONFIG_DIR > homedir() in the ADAPTER).
Dimensions: D-FUNC, D-UX, D-CODE
Scope-Alt: `--project` scaffold flag could be a fast-follow, but AC-046-C/spec require it — keep in scope.
Covers: AC-046-E

Flags: (default) install; `--dry-run` (plan only, zero writes); `--uninstall` (reverse via manifest); `--project` (repo scaffold → ProjectSetupService + flows/setup-project-flow.ts); `--claude-dir <path>` (target override); `--yes` (skip confirmation ONLY).

AC:
- Integration (reachability): From a terminal, When a user runs `lore setup --dry-run --claude-dir <mktemp>`, Then a plan receipt prints to stdout AND the mktemp dir remains EMPTY afterward (zero writes — I4 observable from the entry point, not just unit-tested).
- Integration: From `lore setup --help`, When invoked, Then all six flags (--dry-run, --uninstall, --project, --claude-dir, --yes) are listed (command is registered + reachable, not just constructed).
- Given `--claude-dir X`, When resolving targetDir, Then X wins over $CLAUDE_CONFIG_DIR and homedir(); the SERVICE receives a resolved string (no env/homedir reads leak into the service).
- Given `lore setup --project` in a throwaway git repo, When run, Then the ProjectSetupService scaffold completes (delegates to AC-046-C behavior) and the receipt reports it.
- Full regression: When `bun run typecheck && bun run test` runs, Then both exit 0 (this includes assets-ssot.test.ts → requires the P0 assets tree present, hence this task is blocked by the P0 conformance task).
- Oracle: `bun run typecheck && bun run test` exits 0 (AC-046-E).
