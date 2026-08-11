---
id: PLAN-094
type: plan
role: plan
title: "Implementation — lazy libsql load + TMPDIR diagnostic"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-119
---
## Goal

Make a SQLite-only corpus independent of `TMPDIR` health by deferring the libsql native load, and give the genuinely-Turso path a diagnostic that names `TMPDIR` instead of a raw `dlopen` trace.

Governing spec: `spec-eager-libsql-load-makes-every-command-depend-on-a-healthy` (AC-LL-1 … AC-LL-7).

## Approach

Two tasks, RED before GREEN, with disjoint file anchors so neither blocks the other on anchor overlap:

- **T1 (RED)** writes both oracle files and proves they are live against the CURRENT binary: AC-LL-1/2 MUST fail today (that is the defect), AC-LL-3 MUST pass today (it is the no-regression control). A test file that passes before the fix on AC-LL-1 is a broken oracle, not a green light.
- **T2 (GREEN)** changes the load path and adds the probe until every AC passes, without touching the test files T1 authored.

Ordering constraint from the spec's AC-LL-4: credential validation runs first, the `TMPDIR` usability probe second, the native load only after both.

## Risks

- `createApp` is synchronous with 20 external call sites. A synchronous lazy `require` keeps that contract; a full async conversion is permitted only if complete and typecheck-clean (AC-LL-6). Partial migration is the failure mode to avoid.
- The two runners are not interchangeable: subprocess ACs need vitest, in-process store-identity ACs need `bun test` (`bun:sqlite` is a vitest SSR external). The spec pins which AC lives in which file.
- Compiled-binary ACs measure `dist/lore`; a stale binary silently measures the old code, so T1 and T2 both rebuild before asserting.
