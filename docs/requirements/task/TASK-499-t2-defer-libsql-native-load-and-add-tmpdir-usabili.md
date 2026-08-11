---
id: TASK-499
type: task
role: plan
title: "T2 defer libsql native load and add TMPDIR usability probe"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-094
plan: PLAN-094
---
## Objective

Defer the libsql native load so a SQLite-only corpus never needs a usable `TMPDIR`, and add a `TMPDIR` usability probe whose diagnostic names `TMPDIR` instead of surfacing a raw `dlopen` trace.

## Covers

All of AC-LL-1 … AC-LL-7 must be green when this task closes, using the test files authored by the blocking sibling task — do not edit those files to make them pass.

## Constraints

- `createApp` is synchronous with two overloads and 20 external call sites. Keep it synchronous (a synchronous lazy `require` via `createRequire` is the expected route). A full async conversion is permitted ONLY if complete and typecheck-clean; a partial migration is the failure mode.
- Ordering pinned by AC-LL-4: credential validation FIRST, `TMPDIR` usability probe SECOND, native load only after both. A missing-credential corpus must still report the credential error, not a TMPDIR error.
- No silent fallback: never rewrite `TMPDIR` on the user's behalf, and never downgrade a sync-enabled corpus to SQLiteStore (AC-LL-5).
- Audit the other two static `@libsql/client` import sites (`adapters/cli/commands/sync.ts`, `adapters/http/sync-push.ts`) so neither reintroduces the eager path.
- Rebuild `dist/lore` before asserting any compiled-binary AC.
