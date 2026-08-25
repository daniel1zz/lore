---
id: TASK-845
type: task
role: plan
title: "AC-MOS-1's oracle cannot see the sixth emit branch: cover --governed-by and seed the discriminant types it only conditionally asserts"
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

Close a LIVE blind spot in AC-MOS-1's oracle. The implementation is already correct; the test is
not, and the criterion currently certifies the gap.

## The blind spot, measured

`packages/lore/src/adapters/cli/commands/list.ts` has SIX `--json` emit sites, and its own header
now declares that every one of them emits `ListJsonRow` via `toListJsonRows`. But:

```
grep -c governed packages/lore/tests/integration/list-json-row-contract.test.ts        # 0
grep -c governed packages/lore/tests/integration/list-json-real-corpus-buffer.test.ts  # 0
```

⛔ So if the `--governed-by` branch were reverted to printing `fullDocs`, AC-MOS-1 would PASS.
The code is right and the oracle cannot see it. AC-MOS-1's conjunct (a) has been widened from
five invocations to SIX to name `--governed-by`; this task makes the suite match.

## What to add

1. A `--governed-by <skill>` invocation in the throwaway corpus, asserted exactly like the other
   five: sorted key set EQUALS the ten-key closed set, no `content`, no `extra`, and `meta` built
   by `deriveTypeMeta`.
   ⛔ `--governed-by` is EXCLUSIVE of `--type`/`--status`/`--author`/etc. (the command refuses the
   combination). Seed the fixture with a skill doc and `governs` links so the branch returns rows.
2. Close the review's second finding on the same criterion while you are in the file: (b) says
   "assert the discriminant for EVERY type the run exercises", which a run exercising only
   `knowledge` and `task` satisfies vacuously. ⛔ Make the fixture SEED `spec`, `adr` and `prd`
   docs and assert their discriminants explicitly, so the clause has an executable oracle rather
   than a conditional one. `prd` stays the nine-key default-vs-wide IDENTITY assertion — do not
   force it into the ten-key set.

## ⛔ The recorded red is the point of this task

This is a coverage repair, so "the new case passes" proves nothing on its own. Record an attested
`expected-fail` for the NEW conjunct specifically: in a scratch copy of `list.ts` that you revert,
revert ONLY the `--governed-by` emit site to printing `fullDocs`, run the AC command, and confirm
it now goes RED — ⛔ it must be the `--governed-by` assertion that fails, not an incidental one.
Record it at the moment observed with `--ac AC-MOS-1`. That single probe is the whole proof that
this task closed the gap: before it, that same mutation left the suite green.

Then restore and confirm with `git diff` that your only tracked change is the test file.

## Finish

Scoped: the AC-MOS-1 command, `bun run typecheck`, and `bun run test:changed <base>` if it does
not demand a build. ⛔ Do NOT run the full suite, `lore done`, `bun run build`, or `mirror:export`.
`lore evidence` for every row you observed → commit with this task's slug → `lore release`.
