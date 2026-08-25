---
id: PLAN-148
type: plan
role: plan
title: "Land the two mirror command surfaces: one row contract for list --json, a real argv parser for export-spec-mirror"
status: archived
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: SPEC-153
phases:
  - {name: "command surfaces", description: "Both surface fixes; disjoint anchors, safe to run concurrently"}
---
## Goal

Land the two command-surface fixes SPEC-MOS declares: one row contract for every
`lore list --json` emit branch, and a real argv parser for `export-spec-mirror.ts`
(unknown flags refused, `--type` narrowing that keeps its discriminating power).

## Why two tasks and not one

The two surfaces have DISJOINT file anchors — `packages/lore/src/adapters/cli/commands/list.ts`
versus `scripts/export-spec-mirror.ts` — and neither AC depends on the other's implementation.
They are safe to run concurrently, and the anchor gate will enforce that claim.

## What each task must produce beyond the code

⛔ Both suites are RED BY CONSTRUCTION (their files do not exist, and vitest exits 1 on a
nonexistent path). That red is NOT the demonstrated discriminating power the criteria need —
"the file was missing" is not "the assertion can fail". Each task MUST additionally record an
attested `expected-fail` produced by the smallest mutation its own AC names, taken AFTER the
suite is green, in a scratch copy that is reverted:

- AC-MOS-1: revert one emit site in `list.ts` to printing `fullDocs` verbatim.
- AC-MOS-2: the SAME mutation as AC-MOS-1's, observed through the other criterion — with an emit
  site reverted, the real-corpus read exceeds the consumer's declared 20MB buffer again and
  `spawnSync` returns `status: null` / `error.code: ENOBUFS`. ⛔ Record it as its own
  `expected-fail` row against AC-MOS-2, not as a second mention of AC-MOS-1's: the two criteria
  assert different things (shape in a throwaway vs. the shipped binary against the live corpus)
  and one probe run does not evidence both.
- AC-MOS-3: remove the unknown-flag refusal branch.
- AC-MOS-4: make the narrow path skip the seeded type (conjunct (b) must fail), and separately
  make it scan everything (conjunct (c) must fail).

⛔ AC-MOS-5 is VACUOUSLY GREEN today by the spec's own disclosure. It is a regression guard over
the narrowing this plan introduces. Its pass must never be banked as coverage of AC-MOS-3 or
AC-MOS-4, and no task may report it as work delivered.

## The parent's TRAP, discharged explicitly

The parent spec's inherited MUST: *"Any implementation MUST keep one AC driving the full,
unnarrowed command."* Named here rather than left to be re-derived:

1. **`AC-FR-6` and `AC-FR-7` keep driving it, unchanged.** Re-pointing them at the narrowed
   invocation is explicitly OUT of the parent's scope and out of this plan, so after this lands
   they still execute `bun scripts/export-spec-mirror.ts --check` over every type against the
   real corpus. That is the production wiring, and nothing in this plan touches it.
2. **`AC-MOS-4(a)` drives the full command too**, in a throwaway corpus, as the positive half of
   the narrowing's own discriminating-power test.
3. `AC-MOS-5` is NOT part of this discharge. It asserts a package.json string equality — it pins
   that the chain-wired command stays unnarrowed, but it never RUNS it, so it cannot substitute
   for either of the two above.

## Sequencing note, not a defect

`scripts/tests/export-spec-mirror-argv.test.ts` and `-type-scope.test.ts` land in the same
directory as `scripts/tests/spec-mirror-export.test.ts`, which is itself a consumer of
`lore list --json`. The source anchors stay disjoint so the anchor gate's concurrency claim
holds, and the parent's measured blast radius (that consumer reads only `{id, slug}`) makes the
overlap benign. Recorded so the shared directory is not mistaken for a missed conflict.

## Known downstream cost, deliberately NOT in this plan

Re-pointing `AC-FR-6` / `AC-FR-7` on `spec-falsifiability-reachability-a-feedable-checkpoint-an`
at the narrowed invocation is a `lore ac set` on an APPROVED spec — it demotes that spec to draft
and hard-blocks every descendant claim until it is re-reviewed and re-approved. Sequenced after
this plan lands, named here so it is not discovered mid-flight.
