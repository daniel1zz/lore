---
id: TASK-750
type: task
role: plan
title: "Settle the AC-DC-9 / AC-DC-14(b) conflict, then collapse quota occupancy to one seam"
status: draft
priority: high
phase: "m7"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-132
plan: PLAN-132
---
# Task Objective

Resolve a genuine conflict between two acceptance criteria on this spec, and only then collapse
the quota-occupancy decision to the single seam `AC-DC-14` requires. Found by `lore assess` after
`AC-DC-14` was attested and its task archived.

# The conflict, as measured

`AC-DC-14` control (b) requires: *"the quota-occupancy decision is resolved through ONE seam
whose member set is compared AS A SET against TERMINAL_ISSUE_RESOLUTIONS plus adopted."*

`AC-DC-9` requires exactly one definition site for the terminal member set, and its oracle
asserts this by scanning `packages/lore/src/service/issue-report-service.ts` for the literal
`TERMINAL_ISSUE_RESOLUTIONS.has(`.

The implementer's first design replaced that call with a single `QUOTA_FREEING_RESOLUTIONS.has()`
— which is precisely what `AC-DC-14`(b) asks for — and it reddened `AC-DC-9`. Verified by
`git stash` that `AC-DC-9` passes on unmodified HEAD, so the conflict was introduced, not
pre-existing. The shipped resolution keeps the direct terminal check AND adds a second explicit
`if (live.resolution === "adopted") continue;`. Two real conditions, both consumed — and NOT one
seam. So `AC-DC-14` is green while the property its control (b) states is unmet.

⛔ The implementer made the right call under the constraints and reported it. This is not a
quality failure to re-assign; it is a criterion-design conflict that only the spec owner can
settle.

# The root, and why it is AC-DC-9's oracle rather than the code

`AC-DC-9`'s invariant is "the terminal-resolution set has exactly one definition site". That is a
property of the VOCABULARY MODULE. Its oracle instead pins WHICH CONSUMER SPELLS WHICH CALL in a
named file — an implementation detail. So any refactor that routes a consumer through a derived
set, however faithfully it preserves the single definition site, reddens it.

⇒ First act of this task: decide whether `AC-DC-9`'s oracle should assert the invariant
(one construction site of the member-set literal, repo-wide — which its own §M1 "Declared
uniqueness check" block already describes and which `AC-BFI-14` implements for a different
vocabulary) instead of a per-file call-site literal. ⛔ Do not simply weaken it: `AC-DC-9` is
green with attested passes, so any change is a RE-BASELINE and must be recorded in this spec's
re-baseline log with the original text, this measurement, and why it is a correction rather than
a weakening.

⛔ `--ac-scope` is declared EMPTY on purpose. Until the `AC-DC-9` question is settled there is no
criterion that this task can satisfy without contradicting another, and inventing one now would
be the same over-specification a second time. The orchestrator declares the criterion once the
design is chosen; `lore ac add` does not demote this spec, so that is a cheap step.

# Then, and only then

Collapse the occupancy decision in `issue-report-service.ts` to one seam reading
`QUOTA_FREEING_RESOLUTIONS` (declared in `packages/lore/src/service/issue-resolution.ts`), with
that set DERIVED from `TERMINAL_ISSUE_RESOLUTIONS` ∪ `{adopted}` at its single construction
point — never re-listed.

# Also outstanding on this spec, smaller

- `AC-DC-9` shows 0 pass / 0 fail even though the vocabulary module gained a member and both of
  its named consumers were edited. Its scan was run by hand and reported passing; no evidence row
  is tagged to it. Re-run and record it.
- `AC-DC-2`'s stderr half says every blocking id appears "alongside its resolution" with no
  positional anchor, unlike every sibling render assertion on this spec. Recorded unfixed in the
  spec with its reason; it now has a filing route, since the defect channel has quota again.

# Context Digest

- ⛔ The `adopted` state itself is landed and working — verified 2026-08-21 on the compiled
  binary: `lore issue resolve --state adopted --adopted-by <live plan|task>` exists, and the
  abandonment count/enumerator (`adopted_abandoned_count`) is registered and reads 0.
- ⛔ Do NOT use `lore verify --falsify`: measured 2026-08-21, 11 of 11 invocations were vacuous
  because the scratch worktree cannot run the commands and the runner compares only the exit code
  (`knowledge-lore-verify-falsify-compares-only-the-exit-code-so-an`).
- ⛔ One assess MAJOR on this plan was a FALSE POSITIVE and must not be re-opened:
  `isDanglingAdoption` implements two conjuncts where `AC-DC-16`'s prose names three, but the
  third is SUBSUMED — `computeIssueResolution` returns `"adopted"` only when no explicit terminal
  state (rule 1 returns early) and no resolves-edge (rule 2 returns early) exist. RED SEED (c) in
  `packages/lore/tests/unit/service/issue-resolution.test.ts` tests that subsumption directly.

# File Anchors

None declared yet. The implementation site depends on the `AC-DC-9` decision above; declare
anchors with `lore set` BEFORE claiming, once the design is chosen. Expected neighbourhood:
`packages/lore/src/service/issue-report-service.ts`,
`packages/lore/src/service/issue-resolution.ts`,
`packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts`.
