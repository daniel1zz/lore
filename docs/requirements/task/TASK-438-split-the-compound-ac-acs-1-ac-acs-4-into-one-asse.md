---
id: TASK-438
type: task
role: plan
title: "Split the compound AC-ACS-1 / AC-ACS-4 into one assertion per oracle, running the new halves' oracles in the same slice"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Origin

`knowledge-assessment-implementation-lore-ac-set-the-dangling-ac` (spec recommendation):

> Split AC-ACS-4 and AC-ACS-1 into one oracle per assertion (status demotion vs. lore log
> absence; service write vs. lore ac list output). Compound ACs let a single passing test title
> stand in for two unmeasured claims.

Dispositioned in `knowledge-three-of-four-remaining-assess-gaps-were-bundle` (G2) as executable
but deliberately deferred to this task rather than done as a bare corpus edit.

## Why this is a task and not an edit

Splitting is safe — the naive fear (stranding the evidence rows that point at the old id, the
rm+add cycle that produced three dangling `ac_ref`) does not apply. The correct shape is:

- `lore ac set` on the original id — narrow the statement IN PLACE, id preserved, no dangling
  window. This is exactly what that command shipped for.
- `lore ac add` for the second half under a NEW id.

No existing ref is stranded. What makes it a task is that the new id is born with **zero
evidence** on a spec whose plan is already closed and assessed. A declared-and-unverified
criterion is a worse corpus state than a compound criterion honestly reported as compound: it
manufactures a permanent unmet AC nobody is scheduled to run. The split is only complete when the
second half's oracle runs in the same slice.

## Governance side effect to expect (not an obstacle — the designed path)

Editing a declared criterion demotes the approved spec
`spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` to `draft` (D2). The slice therefore
ends with a re-review and a g2 re-promotion. Budget for it; do not work around it.

## Scope

- AC-ACS-4: halves are (a) approved→draft demotion, (b) draft-stays-draft AND `lore log` records
  no status-transition entry. Only (a) has an evidenced oracle today.
- AC-ACS-1: halves are (a) the service write, (b) the `lore ac list` output.

## Oracle

- After the change, each resulting AC names exactly ONE assertion, and each has at least one
  evidence row of its own. An AC whose statement still contains a conjunction of two testable
  claims has not been split.
- The previously-evidenced half keeps its existing refs — `lore ac list` shows no new `·` or
  `⚑R` on the original id, and `bun run scripts/check-ac-ref-integrity.ts` exits 0 with no new
  dangling ref.
- CONTROL proving the new oracle is not vacuous: the second half's test must fail if its
  assertion is inverted (e.g. make `lore log` record a transition and watch the AC-ACS-4b oracle
  go red). Record that red run as `--result expected-fail`.
- The spec ends `approved` again via a real g2 re-promotion, not via `set --status`.
