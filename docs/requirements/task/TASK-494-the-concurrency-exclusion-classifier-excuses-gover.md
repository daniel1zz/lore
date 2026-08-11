---
id: TASK-494
type: task
role: plan
title: "The concurrency exclusion classifier excuses governed-path throws (false-GREEN vector)"
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

`packages/core/src/issue-report.ts:441` — `hasContentionOutsideReportWrite` ends with:

```ts
return hasStartupHint || UNCAUGHT_STACK_FRAME_PATTERN.test(outcome.stderr);
```

where `UNCAUGHT_STACK_FRAME_PATTERN = /\n\s+at\s/` (line 283). So **any** locked-database
failure carrying a stack trace is classified `not_attributable` and EXCLUDED from
AC-IC-1's sample — regardless of which layer threw it.

The comment at line 282 justifies the branch as "an UNCAUGHT throw, never one of this
codebase's formatted `Result` errors". That premise is true and the conclusion does not
follow: *not a formatted Result error* does not imply *not in the governed path*.

## Why it matters (measured)

Over 300 attempts of `tests/integration/cli/issue-report-concurrency.bun.test.ts`,
**92 excluded invocations carried an uncaught `database is locked` thrown from
`openValidatedUpstream` / `report`** — the upstream write path AC-IC-1 governs.
Captured frames: `run (bun:sqlite:336:21)` → `init` → `new Kr` → `Wy` →
`openValidatedUpstream` → `report`. The remaining ~200 exclusions carried
`loader.ts`'s startup hint and are correctly excluded (consumer-corpus startup
contention, which the contract explicitly does not govern).

By the contract the loser MUST refuse with exit 5 (`WRITE_CONTENTION_EXIT_CODE`) + the declared template. A raw throw
is non-conforming. Today the classifier excuses it, so **the harness can report green
while ~31% of attempts hide a contract violation**. That is a false-GREEN vector in the
one oracle that guards the concurrency contract.

## What to build

Narrow the stack-frame branch so it excuses only throws that are provably NOT from the
governed path — do not delete it (a genuine startup-layer throw carrying no hint still
needs excusing, which is why the branch exists).

The classification must key on POSITIVE evidence, in the same spirit as the existing
`hasStartupHint` two-independent-token rule. Options to weigh in the implementation
(pick one and state why, ≥2 considered):

- require the stack to NOT name a governed-path frame (`openValidatedUpstream`,
  `report`, `createDraft`) — a denylist over frames;
- require the stack to name a known startup-layer frame — an allowlist over frames;
- surface the throw as its own outcome kind so it is neither silently excused nor
  conflated with a template violation.

⛔ Whichever is chosen, a governed-path throw MUST stop being `not_attributable`.
⛔ Do NOT relax `matchesWriteContentionTemplate` or the `LOCKED_DATABASE_MESSAGE_PATTERN`
   precondition, and do NOT touch the bare-`database is locked`-with-NEITHER-marker case:
   line 428-432 documents that it must stay NON-conforming, because that is exactly what a
   contended report write printed before the contract existed.
⛔ Frame names must be matched as lone tokens with independent conditions — a compiled
   binary minifies local function names (`Wy`, `Kr` in the captured trace above), so a
   matcher keyed on a remembered contiguous phrase silently degrades to no-match, and
   no-match here means "excused", i.e. it fails toward false GREEN. Prove the matcher
   against BOTH a source-mode trace and a compiled-binary trace.

## Oracle

`bunx vitest run packages/lore/tests/unit/core/issue-concurrency-classifier.test.ts`

Add cases in both directions (this is the whole point — a one-direction test cannot
distinguish "narrowed correctly" from "narrowed into never excusing anything"):

- POSITIVE: a governed-path uncaught `database is locked` trace → **non_conforming**
  (RED before your change, GREEN after);
- NEGATIVE CONTROL: a startup-layer uncaught trace with no governed frame → still
  `not_attributable` (GREEN before AND after — proves the branch was narrowed, not deleted);
- the existing `hasStartupHint` path and the bare-no-marker non-conforming path unchanged.

## Known interaction — do NOT chase it

`packages/lore/tests/integration/cli/issue-report-concurrency.bun.test.ts` (AC-IC-1) is
ALREADY RED on main for a reason outside your anchor, and your change will make it red
*louder* — previously-excluded runs will surface as real `nonConforming` entries. **That
is the correct outcome and it is what this task is for.** A sibling task fixes the throw
at its source (`issue-report-service.ts`). Do NOT weaken your change to get AC-IC-1 green,
and do NOT run that 225s harness as your oracle — the unit classifier test above is your
oracle.


> **Correction 2026-07-31**: this document previously said `exit 4`. The declared constant is `WRITE_CONTENTION_EXIT_CODE = 5` (`packages/core/src/issue-report.ts:226`), consumed by `isDeclaredLoudFailure`. `exit 4` is this CLI's `VALIDATION_ERROR` code and is a different thing. The governing spec (`spec-report-issue-has-no-specified-concurrency-contract-ac-072`) never named a literal — it says "the contract's declared code" — so the wrong number entered at task-authoring time and was propagated into two dispatch bundles before an implementer measured it. Assert the exported constant, never the literal.
