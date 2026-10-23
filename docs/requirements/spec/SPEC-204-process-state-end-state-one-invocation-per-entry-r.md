---
id: SPEC-204
type: spec
role: spec
title: "Process state end state: one Invocation per entry, returned exit codes, fingerprint ownership, isolated tests"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: [architecture, testing]
links:
  - {id: TASK-1560, type: supersedes}
  - {id: TASK-1575, type: supersedes}
---
## Overview/Goal

The end state of reading process state, stated once and built directly. It replaces the parts of spec-ambient-state-is-read-once-at-the-entry-owned-only-prune that only existed to get there (a stopgap home seam, a text-scanning check with a ratchet ledger, a run-level snapshot guard, a transitional AsyncLocalStorage bridge, process fallbacks, a source-identity ownership record with legacy and foreign skip states, and a phase gate before the test runner change). The decision behind this is adr-ambient-process-state-is-read-once-at-the-entry-one; the user chose on 2026-10-18 to drop the scanner and build the end state.

Motivating incident: on 2026-10-17 an in-process test resolved its write target from the real home while reading fragments from a throwaway folder, and refresh's prune deleted the developer's real `~/.claude/rules/lore-user-*.md`.

Goal, as properties of the finished system:

1. Only the program entries (`packages/lore/src/index.ts` for CLI and MCP, the HTTP server start, each `scripts/*.ts` that runs lore code) read process state. Each resolves one `Invocation` and passes values down as parameters. No function below an entry reads the environment, working directory, home, temp directory, user, host, arguments or executable path, and none substitutes process state for a missing value.
2. `runCli(invocation)` returns an exit code; only the entry calls `process.exit`.
3. Refresh manages only the rules files it rendered: a file is owned when its lore fingerprint is intact (lore wrote it and nobody edited it). A hand-edited file is kept and reported; the person relies on their edits never being lost to a refresh.
4. A write goes through a port whose roots are fixed at construction, and a path outside the roots is refused. Rules file names come from fragment ids that people write in their own fragment files, so a name can carry anything (for example `../`); the port is where such a name meets the filesystem.
5. Tests build an `Invocation` with a throwaway home and call `runCli`; the runner assigns no process global and needs no queue. The test process itself runs with a throwaway `HOME`, because the isolation test below must not damage the developer's data on the day it fails.

## Scope

In scope: `packages/core/src` and `packages/lore/src` (all remaining process reads and fallbacks: `app.ts` `ambientFromProcess`, `os-username.ts`, `store/write-context-store.ts`, `loadLoreApp` without an invocation, `adapters/cli/invocation-scope.ts`, `core/home-dir-node.ts` / `currentHomeDir`, the leaf IO ports, the HTTP and MCP paths), `formatError`'s retry line (computed from the invocation's arguments at the adapter), the rules prune (`flows/context-flow.ts`, `service/context-fragments/rules-ownership.ts`, `section.ts`), `packages/lore/tests/helpers/run-lore-in-process.ts`, the vitest configuration (throwaway `HOME` for the test process), and `scripts/` entries.

Removed: `scripts/check-ambient-reads.ts`, `scripts/ambient-read-ledger.json`, `scripts/tests/check-ambient-reads.test.ts`, `scripts/tests/invocation-node-exports.test.ts`, the `check:ambient-reads` package script, `scripts/test-user-state-guard.ts` and its test and its call in `scripts/test-global-setup.ts`.

Out of scope: how main advances (spec-main-advances-only-through-lore-integrate-per-session).

## Design

**D1 — Invocation everywhere.** `Invocation` (`packages/core/src/invocation.ts`) gains `user` (OS user name) so no code below the entry calls `userInfo()`. App composition takes the invocation (CLI and MCP already pass one; scripts and the HTTP start resolve their own at their entry). Store-layer actor resolution takes the actor from the write context the composition built; it never reads the process. The leaf IO ports receive paths and environment at construction.

**D2 — Exit codes are returned.** Commands report their exit code to `runCli`, which returns it; `index.ts` passes it to `process.exit`. The in-process runner reads the returned code and no longer intercepts `process.exit`.

**D3 — Ownership by intact fingerprint.** The managed header keeps `fragment=<id> hash=<8hex>` only. Outcomes: created, updated, unchanged, diverged_skip (hand-edited: kept and reported), pruned (intact and no longer selected). User and project scope behave the same.

**D4 — Test isolation.** `runLoreInProcess(args, { cwd, env, home })` requires `home`, builds an `Invocation`, calls `runCli`, and returns `{ exitCode, stdout, stderr }` from the invocation's writers. The vitest configuration starts the test process with a throwaway `HOME`.

**D5 — Retry line.** `formatError` takes the retry command line from its caller; the CLI adapter computes it from `invocation.argv` and `invocation.execPath`, so an error names the exact command to re-run without any code reading the process.

**Exit codes** follow the CLI's existing mapping (`exitCode()` in `packages/lore/src/adapters/cli/utils.ts`: validation refusals 4, usage errors such as an unknown flag 2); D2 only changes who calls `process.exit`.

**Files written by the interim build.** Rules files rendered while the interim source-identity header existed carry an extra `source=` token. The header grammar is `fragment=<id> hash=<8hex>` only, so such a header is not an intact fingerprint: the file is kept and reported as diverged_skip, never deleted. The person deletes it or the next selected render of that fragment rewrites it. No compatibility path is added.

## Acceptance Criteria

Structured criteria via `lore ac add` (AC-ES-1..4): concurrent in-process runs with different homes stay isolated and overlap; `runCli` returns exit codes without `process.exit` interception; the prune keeps hand-edited files and prunes intact unselected ones at both scopes; the rooted port refuses outside and symlink-escaping paths (existing oracle).


## Acceptance Criteria (structured)

- [⚑] [script] AC-ES-1: Two runLoreInProcess calls whose commands each wait on a shared latch until both have entered runCli complete (proving they overlap), each writes only under its own throwaway home (the other home is byte-identical before and after), and process.env and process.cwd() are unchanged during and after both runs.
  script: test — bunx --bun vitest run packages/lore/tests/helpers/es-run-lore-in-process.test.ts && echo 'AC-ES-1 PASS: concurrent in-process runs isolated'
  other_command=2
- [⚑] [script] AC-ES-2: runCli(invocation) returns 0 for a succeeding command, 4 for a validation refusal and 2 for an unknown flag, and process.exit is never called during any of these runs (a spy on process.exit records zero calls).
  script: test — bunx --bun vitest run packages/lore/tests/unit/cli/es-run-cli-exit-code.test.ts && echo 'AC-ES-2 PASS: runCli returns exit codes'
  other_command=1
- [⚑] [script] AC-ES-3: At user and at project scope: an intact rules file whose fragment is deselected is pruned; a hand-edited one is kept and reported diverged_skip; the managed header carries only fragment and hash (no source token); no outcome other than created, updated, unchanged, diverged_skip and pruned exists.
  script: test — bunx --bun vitest run packages/lore/tests/unit/context-fragments/es-fingerprint-prune.test.ts && echo 'AC-ES-3 PASS: fingerprint ownership'
  other_command=2
- [⚑] [script] AC-ES-4: A write, delete or removeDirIfEmpty outside the port's roots (a '..' path, a name-prefix sibling, or a path escaping through a symlink on the real port) returns VALIDATION_ERROR and changes nothing.
  script: test — bunx --bun vitest run packages/core/tests/iv-rooted-fs-port.test.ts && echo 'AC-ES-4 PASS: rooted port refuses outside paths'
  other_command=1
