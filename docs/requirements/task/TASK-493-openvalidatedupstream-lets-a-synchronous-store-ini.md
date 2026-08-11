---
id: TASK-493
type: task
role: plan
title: "openValidatedUpstream lets a synchronous store-init throw escape the write-contention re-typing"
status: archived
priority: high
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
links:
  - {id: TASK-492, type: blocks}
---
## Defect

`packages/lore/src/service/issue-report-service.ts::openValidatedUpstream` (line 505)
re-types SQLite write contention into the declared `WRITE_CONTENTION` error at two
points — line 531 (`probeResult.error`) and line 551 (`portResult.error`) — but BOTH
only handle the **`Result`-returning** failure path:

```ts
const portResult = this.deps.openUpstream(cfg.corpus_path);
if (!portResult.ok) {
  const contention = toWriteContentionError(portResult.error, dbPath, this.deps.writeWaitMs);
  return contention !== undefined ? err(contention) : portResult;
}
```

`this.deps.openUpstream(...)` can **THROW synchronously** instead: the store handle's
`init` runs `PRAGMA`/DDL through `bun:sqlite`, which throws `database is locked` from the
constructor, before any Result is ever produced. Nothing catches it, so the throw escapes
`openValidatedUpstream` → `report` and kills the process with a raw stack trace.

## Why it matters (measured)

Over 300 attempts of `tests/integration/cli/issue-report-concurrency.bun.test.ts`,
**92 invocations died exactly this way**. Captured frames:
`run (bun:sqlite:336:21)` → `init` → `new Kr` → `Wy` → `openValidatedUpstream` → `report`.

By the AC-IC-1 contract the loser MUST refuse with **exit 5 (`WRITE_CONTENTION_EXIT_CODE`) + the declared 3-line
write-contention template**. A raw uncaught throw is non-conforming — the operator gets a
stack trace instead of "who contended, against which declared bound, how to retry".

## Same class as an already-shipped fix

`d5396cd` (`task-fix-the-spec-072-cross-corpus-database-is-locked-race`) applied the
declared `busy_timeout` bound to the READONLY probe handle (`flows/upstream-probe.ts`)
after it lost the same race. That fix reached the probe but **not the full-store handle**
opened by `openUpstream`. Read that commit and the SPEC-072 store-CLAUDE.md invariant
before designing: the standing rule is a NATIVE busy handler, never a JS timer/retry
(`bun run check:no-timer-retry` enforces that mechanically).

## What to build

Make a synchronous throw out of `openUpstream` (and the probe call at line 522, if it can
throw for the same reason — verify, do not assume) reach the SAME `toWriteContentionError`
re-typing the `Result` path already gets, so the invocation refuses with the declared code
and template instead of dying.

Consider and state which you chose (≥2 options, with the reason):
- catch at the `openValidatedUpstream` call sites and funnel the caught error through
  `toWriteContentionError`; or
- fix it at the source, so the handle applies the declared `writeWaitMs` bound the same
  way the probe now does and stops throwing in the first place (root-cause shape —
  prefer this if the handle genuinely lacks the bound).

⛔ Do NOT add a JS retry loop, a sleep, or a backoff — `check:no-timer-retry` will fail and
   it is the wrong shape (the declared bound is a native busy handler).
⛔ Do NOT broaden the catch to swallow non-contention failures (missing file, corrupt file):
   those MUST keep propagating verbatim, exactly as the existing comment at line 525-530
   requires. A catch that re-types everything is a silent fallback.
⛔ `toWriteContentionError` must keep reporting the APPLIED bound verbatim (SPEC-078 D9 /
   AC-072 D4) — never a re-derived or defaulted number.

## Oracle

- `bunx vitest run packages/lore/tests/unit/service/issue-report-service.test.ts`
- `cd packages/lore && bun test tests/unit/service/issue-report-cross-corpus.bun.test.ts`
- `bun run check:no-timer-retry`
- `bun run typecheck`

Add a test that FAILS before your change: a lock holder (child process holding
`BEGIN IMMEDIATE` on the upstream) + a `report` invocation → assert exit 5 (`WRITE_CONTENTION_EXIT_CODE`) and the declared
template, not an uncaught throw. Pair it with a control proving the holder is actually
holding (without the holder, the same invocation succeeds) — otherwise a green run cannot
be distinguished from a run where nothing contended.

## Known interaction — do NOT chase it

`tests/integration/cli/issue-report-concurrency.bun.test.ts` (AC-IC-1) is ALREADY RED on
main for reasons outside your anchor and will stay red until a sibling task narrows the
over-broad exclusion classifier in `packages/core/src/issue-report.ts`. Do NOT run that
225s harness as your oracle and do NOT weaken anything to make it green.


> **Correction 2026-07-31**: this document previously said `exit 4`. The declared constant is `WRITE_CONTENTION_EXIT_CODE = 5` (`packages/core/src/issue-report.ts:226`), consumed by `isDeclaredLoudFailure`. `exit 4` is this CLI's `VALIDATION_ERROR` code and is a different thing. The governing spec (`spec-report-issue-has-no-specified-concurrency-contract-ac-072`) never named a literal — it says "the contract's declared code" — so the wrong number entered at task-authoring time and was propagated into two dispatch bundles before an implementer measured it. Assert the exported constant, never the literal.
