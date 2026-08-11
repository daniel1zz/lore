---
id: TASK-443
type: task
role: plan
title: "Both satisfaction-side tightenings: a deferral needs a non-empty reason, and a sidechain disposition cannot discharge"
status: archived
priority: high
phase: "Boundaries"
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-084
plan: PLAN-084
---
# Both satisfaction-side tightenings

Implements `spec-resume-coverage-floor-the-satisfaction-boundaries-a` S1 + S2.
Declared AC scope: AC-RCS-1, AC-RCS-2, AC-RCS-3.

## Source changes — exactly two, both in `packages/lore/src/adapters/cli/commands/handoff.ts`

**1. `parseDispositionedIds` (S1).** Today:

```ts
const isAccepted =
  disposition === RESUME_DISPOSITION_DONE || disposition.startsWith(RESUME_DISPOSITION_DEFERRED_PREFIX);
```

A bare `deferred:` satisfies its own prefix check, so an empty reason closes the
item. Accept a deferral only when the text after the prefix, trimmed, is
non-empty. `disposition` is already `.trim()`ed by the caller, so a
`deferred:   ` reduces to the prefix alone — but assert the whitespace case
explicitly rather than relying on that, because the caller's trim is one edit
away from changing. Keep the existing structure: an unrecognized disposition
stays UNCOUNTED, which routes the id to stderr and into the block reason. Do not
add a warning channel (spec S1 rejects that alternative).

**2. `scanTranscript` (S2).** The loop that collects disposition-bearing
assistant messages:

```ts
const text = extractContentText(content);
if (text.includes(RESUME_DISPOSITION_MARKER)) dispositionBearingMessages.push({ entryIndex, text });
```

Skip the push when the transcript ENTRY (not the message) carries
`isSidechain === true`. Strict equality, never truthiness — an absent field must
preserve today's behaviour (spec S2, and AC-RCS-2's fourth case is its oracle).
Do NOT filter the arming half: the `tool_use` scan and the `tool_result` /
cardinality-line branch stay chain-blind, which is the asymmetry the spec exists
to create. `last_assistant_message` in `runCoverageCheck` also stays unfiltered —
it is main-chain by the Stop contract.

Both functions carry substantial doc comments that state the current contract.
Update them to state the new one, and name the spec's decision label (S1 / S2)
the way the surrounding comments name H4 / H5 — a comment that still describes
the old predicate is worse than none.

## Red-first is a deliverable, not a suggestion

Run the two new AC commands BEFORE editing `handoff.ts` and record the red with

```
lore evidence <this-task> --oracle test --result fail --command '<the AC command>'
```

then the matching `--result pass` rows after the source change. A pass row with
no preceding fail row cannot distinguish a test that pins the defect from a test
that never could.

## Oracles — three AC commands, plus one selector caveat that WILL bite

```
bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "deferral reason"
bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "sidechain"
bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts
```

New `it`/`describe` titles MUST contain the lone tokens the `-t` filters key on
(`deferral reason`, `sidechain`) — a filter that matches zero tests exits 0 with
everything reported skipped, which is byte-indistinguishable from a pass. After
each filtered run, assert the printed matched-file count is 1 and the matched
test count is non-zero.

`bun run test:changed <base>` is NOT sufficient here and its green means nothing
for this change: this test file spawns the CLI as a child process instead of
importing it, so the import-graph selector reports `selected 0` for a change to
`commands/handoff.ts` (measured — `knowledge-two-gaps-t1-surfaced-a-change-selector-blind-to-spawn`
§1). Run `test:changed` for the rest of the repo, and the three commands above
by explicit path.

## Fixture guidance

Existing fixtures in `packages/lore/tests/unit/handoff-coverage-check.test.ts`
already build arming transcripts; reuse that helper rather than hand-rolling a
second transcript builder. Every disposition token and marker must come from its
`@lore/core` export by identity — AC-RCS-1 asserts that, and a typed literal is
the remembered-wording drift vector SPEC-112 D7 forbids.

`isSidechain` is a TOP-LEVEL field on a transcript entry, alongside `type` —
measured against real transcripts, not assumed. AC-RCS-2 needs four fixtures:
sidechain-only dispositions (must block), the same entries at `false` (must not
block), a sidechain-produced ticket with nothing dispositioning it (must still
arm → block), and the field absent (must not block).

## Out of scope — do not touch

- `isSessionResumeFeedToolUse`'s MCP tool-name comparison. Decided against in
  `adr-the-coverage-floor-s-mcp-arming-compares-the-tool-name-s`; changing it
  would silently disarm alias-registered consumers.
- The eight `AC-RCH-*` assertions. If one goes red, that is a real regression in
  this change — report it, do not adjust the assertion.
- `assets/hooks/stop-handoff-coverage.mjs`, the ticket renderer, and the
  governance prose.
