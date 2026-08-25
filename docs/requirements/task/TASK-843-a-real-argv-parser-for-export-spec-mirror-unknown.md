---
id: TASK-843
type: task
role: plan
title: "A real argv parser for export-spec-mirror: unknown flags refused, --type narrows the scan but not the detection"
status: archived
priority: medium
phase: "command surfaces"
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-148
plan: PLAN-148
---
## Objective

Give `scripts/export-spec-mirror.ts` a real argv parser: unknown flags REFUSED instead of silently
ignored, and a `--type` narrowing that keeps every bit of its discriminating power. Closes
AC-MOS-3, AC-MOS-4 and AC-MOS-5.

## What is broken, measured

`main(argv)` reads `argv.includes("--check")` and NOTHING else, then loops `MIRROR_TYPES`
unconditionally. Measured 2026-08-25 on main @ 3331a98e:
`bun scripts/export-spec-mirror.ts --check --type prd --definitely-not-a-flag` exited 2 having
scanned all six types (`adr knowledge plan prd spec task`) and printed no refusal line at all —
so BOTH the bogus flag and the not-yet-existing `--type` were inert in that single run.

This is the same defect class as `knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files`:
a flag that does not exist is accepted, and the command proceeds to do the opposite of what the
caller asked for.

## What to build

1. A real argv parser. An unrecognised flag exits with a DEDICATED, EXPORTED usage constant and
   writes the offending flag verbatim to stderr. ⛔ That constant MUST differ from both `0` and
   `MIRROR_DRIFT_EXIT_CODE` — a drifting corpus and a typo'd flag must never be confusable.
   ⛔ Export it; the AC asserts it by import, never as a literal.
2. `--type <t>` narrows the scan to one mirror type. ⛔ Narrowing the SCAN must not narrow what
   the command can DETECT within the type it scans.

## Three suites, one per criterion — deliberately not one file with `-t`

- `scripts/tests/export-spec-mirror-argv.test.ts` → AC-MOS-3
- `scripts/tests/export-spec-mirror-type-scope.test.ts` → AC-MOS-4
- `scripts/tests/mirror-production-command-unnarrowed.test.ts` → AC-MOS-5

⛔ One file per criterion so each AC command runs UNFILTERED; a `-t` filter satisfies the AC while
leaving the rest of the file unverified.

## ⛔ Never mutate this repo's real docs/requirements

AC-MOS-4 seeds drift. Seed it in a `mkdtemp` + `lore init` throwaway ONLY. The existing
`scripts/tests/spec-mirror-export.test.ts` mutates the REAL mirror, and that is recorded as a
live defect: while it holds a real mirror file deleted, `mirror-status-parity.test.ts` runs
concurrently in another worker (`fileParallelism` default true, `maxWorkers: 4`) and legitimately
reports drift — one file's mutation reddening another. Do not add a second instance of it. The
pattern you want already exists one directory over in `spec-mirror-content-drift.test.ts`.

## ⛔ AC-MOS-5 is VACUOUSLY GREEN and must be labelled so at its assertion site

`package.json`'s `check:spec-mirror` is already byte-identical to
`bun scripts/export-spec-mirror.ts --check` — measured today. AC-MOS-5 is a REGRESSION GUARD over
the narrowing THIS task introduces, not work delivered. Say so in the test file, and ⛔ do not
report it as coverage of AC-MOS-3 or AC-MOS-4. Fixed-string EQUALITY, ⛔ not containment:
containment stays true if someone appends `--type spec`.

## ⛔ The recorded red is part of the deliverable

Red-on-arrival is only "the file does not exist". After the suites are green, produce and record
an attested `expected-fail` for each, in scratch copies you revert, each with its own `--ac-ref`:

- AC-MOS-3: remove the unknown-flag refusal branch.
- AC-MOS-4: TWO separate probes — make the narrow path skip the seeded type (conjunct (b) must
  fail), and separately make it scan everything (conjunct (c) must fail). One probe does not
  evidence both directions.
- AC-MOS-5: change the `package.json` script string in a scratch copy and observe the equality
  assertion fail.

Then restore and confirm with `git diff` that your only tracked changes are
`scripts/export-spec-mirror.ts` plus the three new test files.

## Finish

Scoped oracles only (`bun run test:changed <base>`, the three AC commands, `bun run typecheck`).
⛔ Do NOT run the full suite, `lore done`, `bun run build`, or `mirror:export`.
⛔ Do NOT touch `packages/lore/src/adapters/cli/commands/list.ts` — a concurrent task owns it.
`lore evidence` for every row you observed → commit with this task's slug → `lore release`.
