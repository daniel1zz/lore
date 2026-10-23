---
id: KN-794
type: knowledge
role: knowledge
title: "CLI run-returns-its-exit-code mechanism (evicted from adapters/cli/CLAUDE.md)"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
---
# CLI run-returns-its-exit-code mechanism

Evicted verbatim from `packages/lore/src/adapters/cli/CLAUDE.md` (the run-returns-its-exit-code bullet).

- **A run RETURNS its exit code; nothing below `src/index.ts` calls `process.exit` or sets `process.exitCode`** (`runCli` → `number`, AC-ES-2). A command `run` RETURNS its code (`ExitReport` = `number`, 0 written explicitly for success; helpers return it up) or throws `CliExit` through `exitCli(code)` (`cli-exit.ts`, `never`); `buildMain`'s `reportExit` hands the returned code to `runCli`. Every command is declared with `defineLoreCommand`, whose `run` must return `number | Promise<number>`: a handler or helper that falls off the end, or drops a helper's returned code, is a tsc error, never a silent 0. The type is the mechanism: no audit script, no lint rule. A helper whose `undefined` means "nothing to refuse" (`refuseCorrectionFlag`, `refuseBadTimeoutMs` in `ac.ts`) is typed `number | undefined` and is not an `ExitReport`. There is no scope, no AsyncLocalStorage and no `setExitCode`. ⛔ A `catch` that swallows `CliExit` swallows the exit. Tests calling `cmd.run` directly use `tests/live-invocation.ts::runHandlerForExit`. citty's own exits (`--help`, unknown command, thrown error) are decided by `run-cli.ts::dispatch`, not `runMain`; so is the one mapped throw: `OsUserLookupError` (a write needed an actor and the invocation has no name) ends the run with 4.
