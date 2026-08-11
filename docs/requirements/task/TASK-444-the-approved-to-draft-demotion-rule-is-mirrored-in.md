---
id: TASK-444
type: task
role: plan
title: "The approved-to-draft demotion rule is mirrored in ac-service.ts instead of shared — extract it to @lore/core beside VALID_TRANSITIONS"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Origin

Flagged by the implementer of `task-t1-lore-ac-set-service-cli-six-dimension-suite`
in its own completion report — a deviation it declined to hide:

> D2 says the demotion should go through "the same path" as `CorpusService.set`. My
> anchors do not include `corpus-service.ts`, and this module's own invariant forbids
> cross-service imports. I could not extract a literal shared function. I instead
> **mirrored** the one-line rule inside `ac-service.ts`, with a comment naming
> `corpus-service.ts`'s `isApprovedAutoResetToDraft`.

## The defect

The rule *"an `approved` doc whose contract content changes resets to `draft`"* now
exists in **two implementations**:

- `packages/lore/src/service/corpus-service.ts` — `isApprovedAutoResetToDraft`
- `packages/lore/src/service/ac-service.ts` — `computeSetStatus` (mirrored)

`spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` D2 requires them to be the
SAME rule, and states why: the demotion is what discharges I12 (`no self-weakening`)
for acceptance-criterion edits. Two copies of a governance rule drift; the copy that
drifts is the one nobody is looking at, and the failure is silent — an edit that
should have demoted simply does not, and the criterion is quietly re-reviewed by
nobody.

A cross-referencing comment is a prose mitigation for a mechanism problem. By this
repo's own rule, *a defect already covered by prose is proof that the prose layer is
the wrong layer*.

## Why the implementer was right not to just import it

`packages/lore/src/service/CLAUDE.md` states the module invariant: **"Service per
concern, no cross-service imports — composition lives in `app.ts`."** So
`AcService` importing from `CorpusService` would trade an SSOT violation for an
architecture violation. The implementer correctly refused both and escalated instead.

## The resolution the constraint actually points at

Neither service should own this rule. It is a pure predicate over
`(status, contentChanged)` with no store access, and both services already depend on
`@lore/core`. Extract it there — e.g. `@lore/core`'s lifecycle module beside
`VALID_TRANSITIONS`, which is exactly the same kind of rule and already lives there —
and have both services call it. No cross-service import is created, and there is one
implementation.

Confirm before building that `VALID_TRANSITIONS`' home is the right neighbour and that
nothing else in the codebase already mirrors this rule a third time
(`grep -rn "approved" --include=*.ts | grep -i "draft"` across `service/` and `core/`
before choosing the target).

## Oracle

- Exactly ONE implementation of the rule after the change: a repo-wide search finds a
  single definition, and both `CorpusService` and `AcService` reference it.
- A REGRESSION test that would fail on the mirrored version: change the shared
  predicate's behaviour in the test (or inject a stub) and assert that BOTH the
  content-edit path and the `ac set` path change together. Two call sites that cannot
  be made to disagree is the property being pinned — asserting each one separately
  passes on a mirrored implementation too, and would prove nothing.
- The existing AC-ACS-4 (`ac set` demotes an approved spec to draft) and the
  corpus-service demotion tests both still pass.
