---
id: TASK-1844
type: task
role: plan
title: "Root coverage lists runnable commands statically so the compiled binary can run it"
status: archived
priority: medium
phase: "P2-report"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-230
plan: PLAN-230
---
Regression on main since e8f31519 (T2, task-root-coverage-reports-undeclared-commands-and-names-the): the shipped binary cannot run root coverage. `lore baseline coverage baseline-root` with dist/lore exits 4: `site census: command-unresolved {"reason":"command registry not loadable","registry":"packages/lore/src/adapters/cli/index.ts","cause":"ResolveMessage: Cannot find package 'citty' from '/Users/apple/Projects/zz/lore/packages/lore/src/adapters/cli/index.ts'"}`. From source (`bun run dev baseline coverage baseline-root`) it works (exit 1, 2 undeclared commands). Cause: packages/lore/src/adapters/cli/runnable-commands.ts lists runnable commands by dynamically IMPORTING the analysed checkout's registry and every command module at runtime; a `bun build --compile` executable cannot resolve the checkout's bare package imports (citty) for an external file. T2's tests ran only from source, so nothing caught it.

End state: the runnable-command list is derived STATICALLY from the analysed checkout's source with the same TypeScript program the census uses (site-census.ts): read COMMAND_LOADERS in packages/lore/src/adapters/cli/index.ts, follow each loader to its command module, walk `subCommands` object literals (inline, lazily imported, and factory-built ones — reuse the census's command-object resolution, including the factory-return resolution from task-census-finds-subcommands-built-by-a-factory-function) and list every node with a `run`. No code of the analysed checkout is executed. An unresolvable registry or subcommand is a loud SiteCensusError, never a shorter list.

AC: (1) the compiled binary (dist/lore, built in the test like compiled-census.bun.test.ts does) runs root coverage of a fixture checkout with one undeclared runnable command and exits exactly 1 naming it and its `lore baseline map <leaf> --command` fix; falsifier: today's dynamic-import version exits 4 with command-unresolved. (2) the static list equals today's dynamic list on the real tree (run both from source once; record the comparison). (3) AC-BCR-4's test still passes.
