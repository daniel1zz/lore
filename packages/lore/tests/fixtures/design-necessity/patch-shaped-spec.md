## Overview/Goal

Close the class of defect behind the 2026-10-17 incident (a test run deleted the developer's real `~/.claude/rules/lore-user-*.md`), not the one instance. Decision and mechanism: adr-ambient-process-state-is-read-once-at-the-entry-one.

Goal, in falsifiable terms:

1. A refresh can never delete a rules file it does not own (BR-1176), so a wrongly resolved target folder fails safe.
2. A test run that changes the developer's user-level state fails (AS-27).
3. Writes through a port land only under the port's declared root.
4. Only the program entry reads process-wide ambient state; everything below receives one resolved `Invocation` (AS-26), and a check refuses any new read of the D5 banned tokens.
5. The in-process test runner builds an `Invocation` instead of mutating process globals, so runs no longer need a serial queue.

## Scope

In scope:

- `packages/lore/src/flows/context-flow.ts` rules prune (D1); absorbs task-gh-1343388703-264.
- A user-level state guard for the test runner (D2), next to `scripts/test-isolation-setup.ts` / `scripts/test-isolation-env.ts`.
- `packages/core/src/fs-ports.ts` port contract and `InMemoryFsPort`; the real ports in `packages/lore/src/adapters/cli/commands/context.ts` and `commands/setup.ts` (D3).
- The `Invocation` type, its resolution in `packages/lore/src/index.ts` / `adapters/cli/run-cli.ts`, delivery through `adapters/cli/index.ts` `wrapDefault`, replacing `adapters/cli/invocation-identity.ts`'s module variable (D4).
- `scripts/check-ambient-reads.ts` + ledger, and the layer-by-layer migration of every ambient read in `packages/core/src` and `packages/lore/src` (D5).
- `packages/lore/tests/helpers/run-lore-in-process.ts` (D6).

Out of scope: the MCP server and HTTP server entries get the same `Invocation` only where they share the CLI code path; their own startup reads are allowlisted entry code. The dashboard (no ambient reads today). Re-measuring TG-15 wall time (owned by plan-test-governance; this spec only names the dependency).

## Design

**D1 — Owned-only prune (BR-1176).** Each rendered rules file carries, in its existing lore-managed header, the identity of the fragment source folder (realpath) it was rendered from and the hash of the rendered body. Prune deletes `lore-*.md` only when the header parses, names the SAME source folder as this refresh, and the body hash still matches. Otherwise the outcome is `diverged_skip` (hand-edited) or `foreign_skip` (other source) and the file stays. The record lives in the file's own lore-managed header, so it is written by the same rooted write as the body (D3) and needs no side file. Legacy files (no source identity, written before this change): a file whose id is still selected and whose body equals what this refresh renders is ADOPTED (rewritten with the identity header). A legacy file whose id is deselected or whose body differs is never pruned: it is kept and reported `legacy_skip`, naming the file so the person can delete it. This is deliberate: without a record, ownership cannot be proven, and keeping is the safe side. This amends spec-context-fragments-config-driven-layered-rule-injection D15(c) (prefix ownership → recorded ownership). BR-974 (only `lore-*.md` counts) is unchanged.

**D2 — User-level state guard (AS-27).** The vitest global setup records, before any test runs, a fingerprint (path, size, content hash) of the lore-owned user-level paths only, measured from the HOME the runner STARTED with: `$HOME/.claude/rules/lore-*.md`, `$HOME/.claude/skills/lore-*/`, `$HOME/.claude/CLAUDE.md`, `$HOME/.claude/settings.json`, `$HOME/.claude/hooks/`, `$HOME/.claude/agents/lore-*.md`, and the lore settings folder (`$LORE_CONFIG_HOME`, else `$XDG_CONFIG_HOME/lore`, else `~/.config/lore`). The rest of `~/.claude` (session and project state a live Claude Code session writes constantly) is excluded by construction, not by a deny list. Teardown re-fingerprints and fails the run naming each changed path and the rule id `AS-27`. A test may opt in to a fault-injection fixture home only through the guard's own test.

**D3 — Rooted write port.** `FsWritePort` is constructed with one or more roots. `writeFile` / `deleteFile` resolve the path (realpath of the deepest existing ancestor, so symlinks cannot escape) and, when it is outside every root, return `err({ code: "VALIDATION_ERROR", field: "path" })` with no write. The port methods return `Promise<Result<void, LoreError>>`; callers propagate. `InMemoryFsPort` applies the same check. Amends spec-context-verb-family-two-zone-claude-md-anatomy-lore D9.

**D4 — One resolved Invocation.** `type Invocation = Readonly<{ cwd; env; argv; paths: { home; claudeDir; userConfigDir; projectRoot | null; tmpDir }; host; execPath; isCompiled; identity; io: { stdout; stderr } }>`, defined in `@lore/core` (no Node import; the resolver lives in `@lore/core/node`). `index.ts` resolves it once and calls `runCli(inv)`; `wrapDefault` hands `inv` to every command's `run`. `paths.claudeDir` follows BR-813, `paths.userConfigDir` follows BR-1012/BR-1065 — the existing pure resolvers are reused, only their inputs move. `invocation-identity.ts`'s module-level variable is deleted, not wrapped.

**D5 — Ambient-read check (AS-26).** `bun run check:ambient-reads` scans `packages/core/src` and `packages/lore/src` (non-test files) for the banned tokens listed in this section's table and fails (exit 1) on any hit outside the allowlist, printing `file:line token [AS-26]`. Banned tokens: `process.env`, `process.cwd(`, `process.chdir(`, `process.argv`, `Bun.argv`, `process.execPath`, `Bun.main`, `Bun.env`, `homedir(`, `userInfo(`, `tmpdir(`, `hostname(`, `currentHomeDir(`. Not banned by this check (stated so the goal is not read wider): `process.stdout` / `process.stderr` / `console` (output, not input; `Invocation.io` is used where a command already takes a writer), `process.platform` (constant for the process). Allowlist (exact paths): `packages/lore/src/index.ts`, `packages/lore/src/adapters/cli/run-cli.ts`, `packages/core/src/invocation-node.ts`, `packages/lore/src/adapters/mcp/index.ts`, `packages/lore/src/adapters/http/index.ts`. The two server entries are allowlisted for their startup resolution only; any other ambient read added to them is a review finding, since the check is file-granular. During migration the script also reads `scripts/ambient-read-ledger.json` (file → expected count); a count above the ledger fails, a count below fails until the ledger is lowered (ratchet). `--ledger-empty` fails while the ledger has any entry.

**D6 — In-process runner without global mutation.** `runLoreInProcess(args, { cwd, env, home })` builds an `Invocation` (throwaway home required) and calls `runCli(inv)`. It no longer assigns `process.env`, calls `process.chdir`, or keeps `queueTail`. `process.exit` interception stays until commands return an exit code instead of exiting (out of scope). Lands only after `check:ambient-reads --ledger-empty` exits 0.

## Acceptance Criteria

Structured criteria are attached with `lore ac add` (AC-IV-1..AC-IV-9). Summary:

- AC-IV-1, AC-IV-2 — D1 owned-only prune (BR-1176).
- AC-IV-3 — D2 user-level guard goes red on a write under the real home (AS-27).
- AC-IV-4 — D3 rooted port refuses an outside write, including via symlink.
- AC-IV-5 — D4 every command receives the resolved Invocation; the identity module variable is gone.
- AC-IV-6 — D5 check refuses a planted ambient read with `[AS-26]`.
- AC-IV-7 — D5 ledger is empty.
- AC-IV-8 — D6 two concurrent in-process runs with different homes each write only their own.
- AC-IV-9 — the stopgap `currentHomeDir()` is gone (residual-duplicate check).
