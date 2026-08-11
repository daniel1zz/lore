---
id: KN-212
type: knowledge
role: knowledge
title: "vitest silently drops a nonexistent path and reports a large green test count; lore evidence's oracle-file precheck caught it against the orchestrator itself"
status: approved
priority: medium
created: 2026-08-02
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: TASK-387, type: relates-to}
  - {id: TASK-413, type: relates-to}
---
## What happened (2026-08-02, orchestrator's own merge close-out)

Verifying a merged task, the orchestrator ran:

    bunx vitest run <4 file paths>

and read the summary `Tests 147 passed (147)`, exit 0 — then recorded it as evidence for the
archival. `lore evidence` REFUSED the row:

    Oracle file(s) not found: packages/lore/tests/unit/adapters/done-command.test.ts.
    Checked root(s): /Users/apple/Projects/zz/lore

The path was wrong: the real file is `packages/lore/tests/unit/cli/done-command.test.ts`.
**vitest had silently dropped the nonexistent path and run only 3 of the 4 files** — the summary
line `Test Files 3 passed (3)` says so, but the orchestrator had read the TEST count (147), not the
FILE count, and 147 was a perfectly plausible number for four files.

Running the correct path afterwards: 13 tests, all green — so no regression was hidden. The damage
would have been a permanent evidence row asserting coverage that never ran.

## Why the standing lesson did not prevent it

The corpus already carries "no match + exit 0 is indistinguishable from passed" and an archived
task for vitest silently dropping a `.bun.test.ts` named beside a valid file. This is the SAME
shape at a different input: a path that does not exist at all. Knowing the lesson did not help,
because the failure presents as a large green number. The only local tell is comparing
`Test Files N passed (N)` against the count of paths you passed — a comparison nobody makes when
the run is green.

## The actual mechanism that caught it

`lore evidence`'s oracle-file precheck — a deterministic existence check on the paths named in
`--command`. It caught what the runner, the exit code, the summary line, and a discipline-aware
reader all missed. This is the first observed instance of that precheck catching a real false
oracle in ordinary use, and it caught it against the ORCHESTRATOR, not a subagent.

Worth pairing with the opposite finding from the same session: the same precheck FALSELY refused
`bun run build && cd packages/lore && bun test <e2e>`, because it only recognises a `cd` in the
first segment of a command chain (`task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a`).
So within one session the same mechanism produced one true catch and one false refusal. That is the
expected profile of a useful guard, and it is an argument for FIXING the false-refusal path rather
than loosening the check — the false refusal's real cost is that it nudges authors toward
`--oracle manual`, which would have let this true catch through.

## Transferable rule

When a test command names explicit file paths, the green signal is `Test Files N passed (N)` where
N equals the number of paths passed — not the test count. If the runner cannot be made to fail on a
missing path, an external existence check is the only thing standing between a typo and a permanent
false evidence row. Do not read a large passing test count as proof that the files you named ran.
