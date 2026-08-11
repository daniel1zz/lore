---
id: TASK-409
type: task
role: plan
title: "main is RED: a fourth SelectionReason was added to the producer while a consumer hard-codes the three-value vocabulary in a regex"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

`main` is RED. `bun run test` fails one bun-test assertion because a fourth `SelectionReason`
value was added to the producer without updating a consumer that hard-codes the vocabulary.

Measured 2026-08-01 on a clean tree at `955c26d`:

```
tests/unit/scripts/changed-tests-cli.bun.test.ts:63
  expect(stdout).toMatch(/\((changed-test|transitive|binary-consumer)\)/);

Expected substring or pattern: /\((changed-test|transitive|binary-consumer)\)/
Received: "vitest: selected 2\n  [vitest] .../changed-tests-selector.test.ts (tree-scan-oracle)\n
           [vitest] scripts/tests/check-no-nul-bytes.test.ts (tree-scan-oracle)\nbun: selected 0\n..."
```

`scripts/changed-tests.ts:218` declares:

```ts
export type SelectionReason = "changed-test" | "transitive" | "binary-consumer" | "tree-scan-oracle";
```

`tree-scan-oracle` was added by `9c8f91a` (*"add rule (d) — select tree-scanning oracle tests by
scan scope"*). The type was updated; the assertion's hard-coded alternation was not. Every
selected file in that run legitimately carried the new reason, so the matcher found none of the
three it knew about.

## Mechanism root — the same family this codebase keeps re-hitting

The vocabulary lives in a TYPE, which vanishes at runtime, so the test could not derive it and a
human transcribed a snapshot of it into a regex. A snapshot cannot fail loud when the source
grows — it silently narrows, and (this is the dangerous half) a narrowed matcher that finds
nothing is indistinguishable from a matcher whose subject is genuinely absent.

This is the identical shape as the `expected-fail` evidence-vocabulary family fixed earlier the
same day: one producer, several consumers re-deriving the value set by hand, one consumer missed.
The fix pattern is already established in this repo — `EVIDENCE_RESULTS` (`@lore/core`
`task-workflow.ts`) is a runtime tuple that the Zod schema AND every consumer derive from, so a
new value cannot be added without every derived site seeing it.

⛔ Do NOT fix this by adding `tree-scan-oracle` to the regex. That restores green while leaving
the mechanism that produced the failure fully intact, and the fifth reason will break it again.

## Requirement

1. Export a runtime SSOT for the selection-reason vocabulary from `scripts/changed-tests.ts`
   (e.g. `export const SELECTION_REASONS = [...] as const`), and derive `SelectionReason` FROM it —
   never the reverse.
2. The test builds its matcher from that exported constant. Adding a fifth reason must require
   zero test edits.
3. ⛔ The derived matcher must still be able to FAIL. A matcher built as "any of the known
   reasons" trivially matches any tagged line — so also assert the tag on a line is a MEMBER of
   the set, and that an unknown tag would be rejected. Otherwise this fix converts a too-narrow
   matcher into a vacuous one, which is worse.

## Oracle

- `bun run test:bun` passes on a clean tree. ⛔ Measure the exit code UNPIPED and NOT as the tail
  of a `;`-chained command — `cmd > out 2>&1; echo $?` reports the echo's own status when written
  as one statement chain, which is how this failure went unnoticed in an earlier full-suite report
  this session. Use `cmd > out 2>&1` then `echo $?` as a SEPARATE statement, or check `${PIPESTATUS}`.
- CONTROL, so the new matcher is not vacuous: a synthetic accounting line carrying an unknown tag
  (e.g. `(not-a-real-reason)`) is REJECTED by the assertion. Without this the derived matcher
  proves nothing.
- REGRESSION: a run selecting files tagged `changed-test` / `transitive` / `binary-consumer` still
  passes — the three original reasons keep working.
- BOUNDARY: a run selecting ZERO files still behaves as today (the assertion is guarded by
  `selectedAny`; keep that guard meaningful and assert it).
- A grep for hard-coded selection-reason literals outside the SSOT returns nothing, or each
  survivor is justified by name in the completion report.
