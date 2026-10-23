---
id: TASK-1869
type: task
role: plan
title: "[Skill:refactor] ES-E exit codes are required numbers; stdin comes from the Invocation"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-240
plan: PLAN-240
---
Two places where ES-C2 (landed via lore integrate) left the end state incomplete, found in its review. Both are design gaps, not checks to add.

1. A dropped exit code silently means success. `ExitReport = number | undefined` (packages/lore/src/adapters/cli/cli-exit.ts:26) lets a command handler or helper fall off the end, or call a helper returning a code without returning it, and the run reports 0. The ES-C2 implementer flagged that no compiler catches it. End state: every command `run` handler and every helper that finishes a command returns `number` (0 for success, written explicitly); `undefined` is not a member of the type, so a dropped code is a tsc error. `buildMain`'s `reportExit` and `runCli` take `number`. No audit script, no lint rule: the type is the mechanism.

2. Input still comes from the process below the entry. `process.stdin` / `process.stdin.isTTY` / `process.stdout` (as readline output) are read in packages/lore/src/adapters/cli/commands/setup.ts:259,265, commands/verify.ts:354,449 and adapters/cli/editor.ts:121. End state (spec D1: no function below the entry reads process state): the Invocation's io carries the input stream and whether stdin is a TTY (resolved once at the entry, packages/core invocation type stays Node-free: a structural readable type); prompts use `inv.io.stdin` / `inv.io.stdinIsTTY` and `inv.io.stdout`. The in-process test runner supplies a non-TTY empty input.

Also: the stale comment in packages/lore/src/adapters/cli/stdio-sync.ts (~line 182) that cites "~600 command sites" writing via process.stdout.write; after ES-C2 only third-party writers (citty usage, consola) remain, say that.

Acceptance (red first, then green):
- Oracle 1 `packages/lore/tests/unit/cli/es-exit-code-required.test.ts`: a tsc probe (compile a fixture handler that omits its return, using the project's tsconfig) fails with TS2366/TS7030-class error naming the handler file; and `runCli` on an in-process run of a command still returns 0 / 4 / 2 as in AC-ES-2.
- Oracle 2 `packages/lore/tests/unit/cli/es-stdin-from-invocation.test.ts`: `lore setup` (prompt path) and `lore verify` interactive path driven by an Invocation whose io.stdin is a test stream answering the prompt behave per the answer, with process.stdin untouched (spy records zero reads); with stdinIsTTY false they take the non-interactive path.

These implement the approved spec Goals 1 and 2 (no new behaviour), so the task carries its own oracles (ac_scope empty, the spec is locked); record each with `lore evidence --oracle test --result pass --capture --command "<exact command>"` after an expected-fail red run.
