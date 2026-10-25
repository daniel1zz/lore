---
id: TASK-1853
type: task
role: plan
title: "[Skill:docs] Root CLAUDE.md and shipped agent text describe the retired bun test runner"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Root CLAUDE.md describes a retired test runner. package.json:13 says `test:bun` is retired (task-skill-implement-tg-23: one runner; `bun run test:bun` prints a notice and exits 1), and scripts/run-tests.ts:51-55 runs every test file, `.bun.test.ts` included, under vitest twice (Bun runtime via `bunx --bun vitest`, Node via vitest.node.config.ts). CLAUDE.md still says:
- line 23: `bun run test:vitest  # vitest: every *.test.ts that is not *.bun.test.ts`
- line 24: `bun run test:bun  # bun test: *.bun.test.ts (bun:sqlite)`
- line 28: `cd packages/lore && bun test <file>  # one bun file`
- line 31: "`*.bun.test.ts` run only under `bun test`; every other `*.test.ts` only under vitest. Never mix runners."

Fix: read the content contract first (`lore governance claude-md`), then make the Commands block state what the scripts do today (verify each line against package.json and scripts/run-tests.ts; how a single `.bun.test.ts` file is run now — `bun run test:file <path>` or `bunx --bun vitest run <file>` — check test-file.ts). Keep the file within its budget (`lore status --check-claude-md` before and after, report both). Also check `assets/agents/lore-implementer.md:65` item (3) and `.claude/rules/lore-project-scoped-oracles-in-worktrees.md:4,6` (the latter is generated from assets/context — find its fragment source and fix there, then rebuild so the assets manifest matches): if they still say `.bun.test.ts` runs under a separate runner, correct them the same way.

Oracle: `lore status --check-claude-md` exits 0, and `bun run check:static` steps for memory files / assets manifest pass (run the relevant check:* scripts). Record with `lore evidence <task> --oracle lint --result pass --capture --command "<exact command>"`.
