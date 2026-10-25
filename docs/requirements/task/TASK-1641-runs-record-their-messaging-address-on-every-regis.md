---
id: TASK-1641
type: task
role: plan
title: "Runs record their messaging address on every register; run show prints it"
status: archived
priority: high
phase: "record"
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PLAN-213
plan: PLAN-213
links:
  - {id: TASK-1635, type: blocks}
---
Estimate: M
Covers: AC-MA-1, AC-MA-2 (spec-runs-carry-their-messaging-address-holder-listings-show-it; BR-1360)
Blocked by: task-claims-compare-runs-only-the-store-refuses-a-run-less (it adds migration 027 and moves LATEST_SCHEMA_VERSION; take the next free number on main at claim time).

## Approach

1. Hook (`assets/hooks/run-register.mjs:89-94`): on SessionStart only, when `process.env.CLAUDE_CODE_MESSAGING_SOCKET` is non-empty, append `--messaging-socket <raw path>`. No `uds:` grammar in the hook (its D10 invariant, :30-34). SubagentStart passes no flag. Exit 0 on every path. Regenerate `packages/lore/src/generated/assets-manifest.ts`.
2. CLI `runRegister` (`packages/lore/src/adapters/cli/commands/run.ts:191-227`): accept `--messaging-socket`; compose the address by harness: `claude-code` → `uds:<path>`; a harness without a known grammar given the flag, or an empty or non-absolute socket path, fails loud (exit 2, nothing stored), never stores a guess (plan I1). Assert both refusals in run-message-address.bun.test.ts. Main runs only: a subagent register stores NULL.
3. Schema: next free migration (after the blocker lands) adds nullable `runs.message_address` (two-phase PRAGMA table_info check like migration-021, sqlite-store.ts:747); bump `LATEST_SCHEMA_VERSION` in `packages/lore/src/store/schema-version.ts`; Turso and in-memory stores likewise.
4. Write: a NEW unconditional per-register write `recordRunAddress(runId, address | null)` on `StoreInterface` (`packages/lore/src/store/store-interface.ts`, next to the run process method at :1382) called on EVERY `register` (run-service.ts:176-233), NOT inside the `input.process !== undefined` branch (:220-225), so a register without --harness-pid still writes, resume replaces, absence clears (Invariant I2). Not in `insertRun` (INSERT OR IGNORE keeps the first value).
5. Read: `RunRecord` / `runRecordSchema` (`packages/core/src/run-identity.ts:70-99`, camelCase) gain `messageAddress: string | null`, through the candidate schema check in register (run-service.ts:198-214). `renderRunText` (run.ts:163) prints `address: <value>` or `address: none recorded`; `run show --json` (run.ts:237) emits RunRecord as is, so the key is `messageAddress`.

Source: lore-reader survey and bundle review 2026-10-20; precedent AC-AU-5 harness pid columns, AC-ROI-6 resume reopen.

## AC

- Red first: write `packages/lore/tests/integration/cli/run-message-address.bun.test.ts` and the `messaging socket` cases in `packages/lore/tests/unit/hooks/run-register-hook.test.ts`; capture them failing (`--result expected-fail --capture`), then implement.
- AC-MA-1 and AC-MA-2 commands (lore ac list on the spec) exit 0; the hook test file must collect at least one `messaging socket` test.
- Scoped floor: run-register.bun.test.ts, run-show.bun.test.ts, run-composition.bun.test.ts, autonomy-run-reap.test.ts, run-agent-ref.bun.test.ts, distribution-hooks.test.ts, assets-ssot.test.ts, every file importing StoreInterface's run methods; `bun run typecheck` exit 0.

Scope-Alt: none (both halves are needed for any address to exist).
