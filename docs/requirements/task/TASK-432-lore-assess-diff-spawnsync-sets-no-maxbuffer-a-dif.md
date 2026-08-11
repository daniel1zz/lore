---
id: TASK-432
type: task
role: plan
title: "lore assess --diff spawnSync sets no maxBuffer: a diff over 1 MiB exits 2 blaming git for this call sites own ceiling"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Found while sweeping the CLAUDE.md standing-lessons layer for mechanized-eviction candidates
(`task-sweep-the-claude-md-standing-lessons-layer-against-the`): the `spawnSync` `maxBuffer`
standing lesson has a live, shipping instance in production code.

## What was measured

`packages/lore/src/adapters/cli/commands/assess.ts:153`

    const gitResult = spawnSync("git", ["diff", args.diff], { encoding: "utf8" });

No `maxBuffer`. Node's default is 1 MiB. A standalone probe (2 MiB of stdout, no `maxBuffer`)
reproduced the failure mode: `error.code: "ENOBUFS"`, `stdout` truncated to 1114112 bytes,
`status: null`.

## Corrected severity — this is LOUD, not silent

The line immediately after the call is:

    if (gitResult.error || gitResult.status !== 0) { ... process.exitCode = 2; return; }

`gitResult.error` is set on ENOBUFS, so the truncated `stdout` is NEVER consumed and
`ai.assess.max_diff_chars` never sees a short diff it believes is complete. The standing lesson
phrase "silently truncates" does NOT apply at this call site — verified by reading the branch, not
inferred.

The real defect is narrower and still worth fixing:

1. `lore assess --diff <range>` becomes IMPOSSIBLE for any plan whose diff exceeds 1 MiB — an
   ordinary size for a multi-task plan.
2. The refusal message is MISLEADING: it renders as `git diff <range> failed: spawnSync ENOBUFS`,
   attributing to git a failure that belongs entirely to this call site's buffer ceiling. An
   operator reading it goes looking at git, not at `maxBuffer`.

## Required

- Set an explicit `maxBuffer` on this call, sized against `ai.assess.max_diff_chars` rather than an
  arbitrary constant — the diff is truncated to that budget anyway, so the buffer should be the
  smallest value that cannot truncate BELOW it.
- Do NOT merely raise the number and move on: an ENOBUFS that still occurs must name its own cause.
  Branch on `error.code === "ENOBUFS"` and emit a message naming the buffer and the knob, instead of
  blaming git.
- Audit the two sibling unguarded call sites found in the same sweep and disposition each
  explicitly (fix, or record why the output is bounded by construction):
  `packages/lore/src/adapters/cli/commands/setup.ts:346`, `scripts/build.ts:327`.

## Oracle

A test driving the ENOBUFS branch with a synthetic oversized diff, asserting the message names the
buffer rather than git — plus `bun run typecheck`.
