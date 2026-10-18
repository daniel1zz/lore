---
id: ADR-050
type: adr
role: decision
title: "Ambient process state is read once at the entry: one resolved Invocation, rooted writes, owned-only prune"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: [architecture, testing, safety]
parent: PRD-001
links:
  - {id: ADR-048, type: relates-to}
---
## Context

On 2026-10-17 a test run deleted the developer's real `~/.claude/rules/lore-user-*.md` (6 static rules files) and left one fixture file behind. Reproduced on 2026-10-18 (revert `currentHomeDir()` to `os.homedir()` in `packages/lore/src/adapters/cli/commands/context.ts`, start vitest with a scratch HOME: the scratch HOME ends with exactly `lore-fixture-keep-rule.md`, the same state as the real one).

Mechanism, three conditions together:

1. Under Bun, `os.homedir()` returns the HOME the process STARTED with; a later `process.env.HOME` assignment is ignored (measured; Node re-reads `$HOME`).
2. TG-25 (adr-tg-1 option b) moved command tests in-process: `packages/lore/tests/helpers/run-lore-in-process.ts` rewrites `process.env`, `process.cwd()`, `process.exit` for one run and serialises runs through a global queue, because process-wide state cannot be scoped per run.
3. `context refresh --scope user` read fragments from `LORE_CONFIG_HOME` (the sandbox, via `process.env`) but resolved its write target from `os.homedir()` (the real home). The D15 prune (`packages/lore/src/flows/context-flow.ts` ~589, spec-context-fragments-config-driven-layered-rule-injection D15(c)) then deleted every `lore-*.md` outside the sandbox's keep set.

No guard fired: the AC-TG-3 tree snapshot and the AC-TG-7 read recorder see only the repository tree (`scripts/test-read-log.ts` `toRepoRelative` drops outside paths).

Commit 303ce06d added `currentHomeDir()` (`packages/core/src/home-dir-node.ts`), which re-reads `$HOME` at call time. That closes this instance only: commands still read ambient process state at any depth (lore package: ~59 `process.env`, ~65 `process.cwd()`, 10 `currentHomeDir()`, 7 `tmpdir()` sites; service/flow layer included: `setup-service.ts`, `feed-flow.ts`, `verify-runner-service.ts`), nothing refuses a new `os.homedir()`, and the test helper still has to mutate globals and serialise.

## Decision

Five parts, one direction: ambient state is read once, at the entry, and everything below receives it.

1. **One resolved `Invocation` per run.** The program entry (`packages/lore/src/index.ts` → `runCli`) is the composition root and the ONLY place allowed to read process-wide ambient state: `process.env`, `process.cwd()`, `os.homedir()`, `os.userInfo()`, `os.tmpdir()`, `os.hostname()`, `process.argv`, `Bun.main`, `process.execPath`. It resolves one immutable `Invocation { cwd, env, paths { home, claudeDir, userConfigDir, projectRoot, tmpDir }, io { stdout, stderr }, identity }` and passes it down. Commands receive it through the existing `wrapDefault` seam in `packages/lore/src/adapters/cli/index.ts` (citty `run()` cannot take arguments; the module-level `invocation-identity` variable is replaced, not copied). Flows and services take the fields they need as parameters (they already accept injected deps: `buildRefreshFragmentDeps`, `resolveUserConfigDir(env, home)`, `resolveTargetDir({ env, homeDir })`).
2. **Writes are rooted.** A write port is constructed with the root(s) it may write under; a write or delete whose resolved path falls outside returns a `LoreError` (fail loud, AS-error model), never writes. Real ports and `InMemoryFsPort` share the check.
3. **Prune deletes only what it owns.** Refresh records, per rendered rules file, the fragment source folder identity and the rendered bytes' hash (the same fingerprint discipline the skill prune already uses, BR-1060/1064). Prune deletes a file only when its record names the same source folder and its bytes still match; otherwise it reports the file (`diverged_skip` / `foreign_skip`) and deletes nothing. A refresh whose fragment source differs from the one that wrote the folder deletes nothing. The record lives in each file's own lore-managed header (written by the same rooted write, no side file). Legacy files without a record are adopted only when still selected and byte-equal to what this refresh renders; any other legacy file is kept and reported, never pruned. This supersedes the prefix-only ownership of D15(c) and absorbs task-gh-1343388703-264.
4. **Tests never write user-level state.** A guard fingerprints only the lore-owned user-level paths (`~/.claude/rules/lore-*.md`, `skills/lore-*/`, `CLAUDE.md`, `settings.json`, `hooks/`, `agents/lore-*.md`, the lore settings folder) of the HOME the runner started with, around the test run, and fails on any change; the rest of `~/.claude` is live session state and is excluded by construction; the in-process helper builds an `Invocation` pointing at a throwaway home instead of mutating `process.env`.
5. **The boundary is enforced, not remembered.** A `check:ambient-reads` script (modelled on `scripts/check-no-timer-retry.ts`: banned tokens and the composition-root allowlist read from the governing spec) fails on any ambient read outside the allowlist. During migration it reads a shrinking ledger; the serial queue in the test helper is removed only when the ledger is empty.

## Alternatives considered

- **Keep the `currentHomeDir()` seam and add more seams.** Rejected: each seam still reads a global, so the helper must keep mutating globals and serialising; each new ambient read is a new silent leak.
- **Move user-scope tests back to spawning `dist/lore`.** Safe for those tests, but abandons adr-tg-1's measured speedup (~260 ms vs ~91 ms per call) and hides the defect rather than removing it: production commands would still read globals at arbitrary depth.
- **Sandbox only by environment variables (`CLAUDE_CONFIG_DIR`, `LORE_CONFIG_HOME`).** Rejected: depends on every code path honouring the variable; this incident was exactly one path that did not.

## Consequences

- adr-tg-1's decision (in-process helper) stands; only the helper's mechanism changes. Removing the serial queue lets in-process tests run concurrently; TG-15 / AC-TG-11 wall-time numbers change and must be re-measured after that phase.
- spec-context-fragments D15(c) is amended (prefix ownership → recorded ownership); AC-CF-6 changes.
- spec-context-verb-family D9 port contract gains a root and a `Result` on write.
- AS-14 covers only the repository corpus; a sibling testing standard covers user-level state, and a layering standard records the ambient-read boundary with its current exceptions as debt.
- Riskiest step: removing the serial queue before every ambient read is migrated would make concurrent tests leak into each other intermittently. Hence the queue goes last, gated on an empty ledger, not on a shrinking one.
