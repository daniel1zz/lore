---
id: KN-702
type: knowledge
role: knowledge
title: "Evicted from the store module doc: lazy libsql load and busy_timeout ordering (verbatim)"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
---
# Evicted from packages/lore/src/store/CLAUDE.md (verbatim)

Two Key Invariants blocks moved here by R0-4 (claude-md eviction floor). The module file keeps the rule lines and points here for the mechanism, measurements and consequences.

## Lazy @libsql/client load

- **`@libsql/client` is loaded LAZILY, and only via a literal-specifier dynamic `import()`** (`turso-store.ts::loadLibsqlClientModule`) — a static top-level import made every command that builds an `App` resolve the native `.node`, so a bad `TMPDIR` killed even a SQLite-only corpus. Consequences that are NOT optional: (a) ⛔ `createRequire`/`import.meta.require` DO NOT work from a compiled binary — do not "simplify" the dynamic import into one; (b) `TursoStore`'s constructor takes an optional pre-resolved `injectedClient`, and `commands/sync.ts` (the one compiled-reachable constructor caller) pre-resolves and injects it, which keeps the constructor synchronous-throwing for `sync-cli.bun.test.ts`; (c) `app.ts`'s Turso branch keeps a SYNCHRONOUS `createRequire` fallback safe ONLY from source mode — unreachable from a compiled CLI because `adapters/cli/loader.ts` strips `config.sync` unconditionally, guarded on BOTH halves (`AC-LL-8` behavioural + `AC-LL-10` source scan: no `createApp` call site passes a sync-bearing config; ⛔ `app.ts::createAppWithWriteContext` is OUTSIDE that scan, guarded only by its `sync?: never` type). ⛔ A future caller genuinely needing one is resolved by finishing the async conversion, never by adding a scan exception; (d) `probeTmpdirUsability()` runs AFTER credential validation and BEFORE any native load, so a missing-credential corpus reports the credential error. ⛔ Cold start dropped ~5x, which exposed a latent `database is locked` race in the SPEC-072 cross-corpus write path — never "fix" that by restoring an eager load or adding delay. SSOT: `spec-eager-libsql-load-makes-every-command-depend-on-a-healthy`.

## SQLiteStore.init busy_timeout ordering

- **`SQLiteStore.init` sets `PRAGMA busy_timeout` to the DECLARED bound, FIRST** — before `journal_mode`/`foreign_keys`, because `PRAGMA journal_mode = WAL`'s prepare step opens the pager and can need wal-index recovery; issued third it ran under bun:sqlite's default 0ms and threw `database is locked` out of the CONSTRUCTOR (measured 24/240 cold opens, 0/240 once hoisted; negative control — the same hoist with the bound at 0 still throws 31/240, so it is the DECLARED BOUND armed EARLY, not the reorder). The bound is `SQLiteStoreOptions.writeWaitMs`, defaulting to `@lore/core`'s `DEFAULT_WRITE_WAIT_MS` — the ONE home of the number; `report-issue` overrides it from `feedback.upstream.write_wait_ms` and reports the APPLIED value verbatim on expiry. A non-integer/negative bound throws at construction (never a silent clamp). ⛔ **The bound is not store-only: ANY `bun:sqlite` handle opened against a corpus another process may write needs it**, because `bun:sqlite` defaults it to 0 PER CONNECTION regardless of what other connections set — the readonly schema-version probe (`store/schema-probe.ts::probeSchemaVersion`, relocated there in P4 of spec-the-defect-channel-reaches-no-machine-but-its-own-github from a now-deleted SPEC-072 `flows/` module) shipped without it and lost the race at 3/3 reproduction. Always the NATIVE busy handler, never a JS timer/retry (`bun run check:no-timer-retry` enforces this). ⛔ **A bound does not make construction infallible**: SQLite ignores the busy handler for a journal-mode SWITCH and any bound can expire, so every `Result`-returning caller MUST catch it. A failed `init()` closes its own handle before re-throwing, so a recovering caller leaks no fd or lock. Regression: `tests/unit/store/busy-timeout.bun.test.ts` (discriminates on ELAPSED TIME, since both orders fail against a holder outlasting the bound). SSOT: SPEC-078 D9, `spec-report-issue-has-no-specified-concurrency-contract-ac-072` D4.
