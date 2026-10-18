## Overview/Goal

A test run must never read or change the developer's real user-level state (the incident of 2026-10-17: a test run deleted the developer's real `~/.claude/rules/lore-user-*.md`). The cause is that code below the program entry reads process-wide ambient state (home directory, working directory, environment) on its own, so a wrongly resolved folder reaches a delete.

Goal, in falsifiable terms:

1. Only the program entry reads ambient process state. It resolves one `Invocation` and passes it down as a parameter; no function below the entry reads the home directory, the working directory or the environment, and none substitutes process state when a value is missing.
2. A refresh manages only the rules files lore itself rendered and leaves a hand-edited file to the person: a rules file the person edited by hand is never deleted or overwritten (the report in gh-264: a hand-edited, deselected file was deleted). The person relies on this: their own edits are never lost to a refresh.
3. Every write goes through a port whose roots are fixed at construction; a path outside the roots is refused with no write. Rules file names derive from fragment ids read from user-controlled fragment files (frontmatter `id:`), so a path can carry whatever the person wrote in that file (for example `../`) and is checked where it reaches the filesystem.
4. Tests build an `Invocation` that points at a throwaway home, and the test process itself runs with a throwaway `HOME`. The reason for the second part: the acceptance test of goal 1 must be safe and meaningful when the design is violated. If an ambient read below the entry ever returned, the concurrent-isolation test would otherwise write the developer's real home while failing.

## Scope

In scope:

- The `Invocation` type (cwd, env, argv, resolved paths, identity, output streams), resolved once in the program entry and passed to every command as its parameter.
- The rules refresh in `packages/lore/src/flows/context-flow.ts`: each rendered rules file carries lore's fingerprint in its own managed header; refresh creates, updates, leaves unchanged, or prunes only files whose fingerprint is intact, and leaves a hand-edited file alone.
- The write port in `packages/core/src/fs-ports.ts`: constructed with its roots, refusing any path outside them (symlinks resolved first), with an in-memory twin that applies the same rule.
- The in-process test runner in `packages/lore/tests/helpers/run-lore-in-process.ts`: builds an `Invocation` from the caller's throwaway home and does not touch process globals.

Out of scope: the MCP and HTTP server entries beyond receiving the same `Invocation` where they share the command path; the dashboard.

## Design

**One resolved Invocation.** `Invocation` is a readonly value: `cwd`, `env`, `argv`, `paths` (home, claude directory, user config directory, project root or null, temp directory), `identity` and `io` (stdout, stderr). The program entry builds it once and calls `runCli(invocation)`; the command wrapper hands it to each command's `run`. Every function that needs a path or an environment value takes it from its `Invocation` argument. A value the entry cannot resolve is an error at the entry (`VALIDATION_ERROR` naming the missing value), not a default taken from process state further down. The old module-level identity variable is deleted.

**Owned-only prune.** A rendered rules file carries a lore fingerprint (a hash of its body) in its managed header. A file is owned when its fingerprint is intact: lore wrote it and nobody edited it. Refresh reports one outcome per file: `created`, `updated`, `unchanged`, `diverged_skip` (the person hand-edited it; it is kept and reported by name) or `pruned` (an owned file whose fragment was deselected). The reason is the user's expectation, not a safety net for a wrong folder: with the single resolved `Invocation` a wrong target folder cannot occur, and the person's own edits are theirs.

**Rooted write port.** `FsWritePort` is constructed with one or more roots. `writeFile` and `deleteFile` resolve the target (real path of the deepest existing ancestor) and return `err({ code: "VALIDATION_ERROR", field: "path" })` with no write when it lies outside every root. `InMemoryFsPort` applies the identical check, so a test against the in-memory port proves the production rule.

**Test runner.** `runLoreInProcess(args, { cwd, env, home })` requires a throwaway home, builds an `Invocation` from its arguments and calls `runCli(invocation)`. It assigns no process global, so concurrent runs with different homes do not interfere. The test process starts with a throwaway `HOME` for the stated reason of goal 4: the acceptance test must stay safe and meaningful if the design is violated, so a failing run cannot write the developer's real home.

## Acceptance Criteria

- AC-ES-1: Two concurrent in-process runs, each given a different throwaway home, each write only under their own home; neither run's files appear under the other's home, and the developer's real home is untouched. Verified by a behavioural test that runs both at once and lists both homes afterwards.
- AC-ES-2: A refresh leaves a hand-edited rules file in place and reports it `diverged_skip` by name, deletes an unedited deselected file (`pruned`), and reports `created`, `updated` and `unchanged` for the rest. Verified by a test that builds one file of each kind and runs the refresh.
- AC-ES-3: `FsWritePort` and `InMemoryFsPort` refuse a path outside their roots, including one reached through a symlink, with `VALIDATION_ERROR` on field `path` and no file written. Verified by a test that attempts a direct path, a `..` path and a symlink path against each port.
