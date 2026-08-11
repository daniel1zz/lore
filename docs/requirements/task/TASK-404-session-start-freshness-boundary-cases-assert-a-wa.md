---
id: TASK-404
type: task
role: plan
title: "session-start-freshness BOUNDARY cases assert a wall-clock budget for an ORDERING invariant: 116ms and 133ms red under full-suite load, 13/13 green alone"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
---
Recurrence-triggered, per the standing instruction in
`knowledge-handoff-agent-main-orchestrator-56` NS2: *"If it recurs, raise or remove the timing
assertion rather than the code."* It recurred.

## Measured 2026-08-01, full suite on clean main at 438976b

    FAIL packages/lore/tests/unit/hooks/session-start-freshness.test.ts
      > BOUNDARY (R2 real-subprocess oracle)
        > missing cache: hook exits without waiting (<100ms), ...
            expected 116.353834 to be less than 100
        > on-disk cache older than 24h is treated identically to a missing cache
            expected 132.55812500000002 to be less than 100

Same file run ALONE, same commit: `Test Files 1 passed (1)`, `Tests 13 passed (13)`, exit 0.
Prior occurrence recorded at 132.9ms. The failures are load-dependent, not behavioural.

## Root cause — the oracle encodes the wrong quantity

The invariant these cases exist to protect is an ORDERING one: the hook returns WITHOUT waiting for
its detached child, and the child later writes a valid cache. The test encodes that as an ABSOLUTE
wall-clock budget (`< 100ms`). Under full-suite contention the hook's own honest, non-blocking exit
routinely takes 116-133ms, so the assertion reports a blocking hook that is not blocking.

⛔ Raising the number is a symptom fix: it re-fails on a busier machine and, worse, a genuinely
blocking hook that happens to block for less than the new threshold passes. The number and the
invariant are not related by anything.

## Why this matters beyond one flaky test

`knowledge-mechanized-eviction-sweep-of-the-claude-md-standing` EVICTED the CLAUDE.md standing lesson
"session-start hooks inject computed state, never do blocking work" ON THE STRENGTH OF THIS TEST being
its enforcing mechanism. The eviction is sound — the mechanism does fire — but an oracle that reds on
load teaches readers to ignore it, which is how a mechanized lesson quietly becomes unenforced. A
prose line was removed in exchange for this assertion; the assertion should be worth the trade.

## Required

- Re-found both BOUNDARY cases on the ORDERING signal instead of a duration: assert that the hook
  process has EXITED while the cache file does not yet exist, and that the cache subsequently appears
  written by the detached child. That is the actual claim, and it is immune to machine load.
- Keep a duration bound ONLY if it can be made relative (e.g. hook exit is an order of magnitude
  faster than the child's own completion), never an absolute constant.
- The sibling cases asserting "spawns 0 lore child processes" and exact injected-byte counts are
  already load-independent — leave them byte-identical.
- Verify the new assertions FAIL on demand: make the hook synchronously await its child in a scratch
  copy and confirm the ordering assertion reds. An oracle that cannot be made to fail has not been
  demonstrated.

## Oracle

The file passes standalone AND inside a full `bun run test` on a loaded machine, plus the
deliberate-blocking control above going red.
