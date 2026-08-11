---
id: TASK-323
type: task
role: plan
title: "Build the attested-red runner: a declared falsifier applied in an isolated worktree produces a runner-captured expected-fail"
status: archived
priority: medium
phase: "evidence-integrity"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-076
plan: PLAN-076
---
Build the attested-red runner: an AC may DECLARE its own falsifier, and `lore verify` applies it in
an isolated scratch worktree to produce an `expected-fail` row whose `capture_source` is `runner`.

⛔ This closes a STRUCTURAL gap, not an implementer habit. `lore verify` today runs an AC's declared
command against the CHECKED-IN tree; a red requires the tree to be temporarily BROKEN, so no attested
`expected-fail` can be produced by any means. Measured 2026-08-10: `lore assess` reported
`attested_fail = 0` on EVERY AC of three separate plans and cut `evidence_integrity` accordingly,
while the standing rule "every oracle needs one measured red" is enforced by self-report alone.

Deliver:

1. **A `falsifier` field on a script-mode AC** — a named mutation (file + edit, or a patch) plus the
   exit code it is expected to produce. Declared via `lore ac add/set`, validated like any other AC
   field. The point is to force the AC author to state the failure mode at authoring time.
2. **The runner path** — `lore verify` (or a sibling subcommand; your call, but say which and why)
   creates a scratch git worktree, applies the falsifier there, runs the AC command in it, asserts
   the exit code EQUALS the declared value, records the `expected-fail` row with
   `capture_source: runner`, and removes the worktree.
3. **Isolation that survives a crash** — ⛔ the mutation is NEVER applied to the working tree. A
   `finally`-block revert is not acceptable: this repo already shipped a backup that was written but
   never read back, and its "survives a crash" comment was false for months.

⛔ Do NOT relax `executedSuccessfully` or any completeness gate to make reds record. A prior analysis
established that the obvious version of that fix is a measured no-op — all three runners' discovery
refusals carry no summary line, so `parseExecutedUnits` returns null and `judgeCompleteness` answers
`unknown_runner`, never `zero_match`. See `spec-oracle-executability-…` §M6.1.

Context worth carrying: this task's own ACs are the first two in the corpus that will be able to
carry a falsifier. Dogfood it — declare falsifiers on AC-FR-2 and AC-FR-3 themselves once the field
exists, and say in your report whether doing so revealed anything the design missed.
