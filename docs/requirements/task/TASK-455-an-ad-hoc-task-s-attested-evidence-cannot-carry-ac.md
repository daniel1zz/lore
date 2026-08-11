---
id: TASK-455
type: task
role: plan
title: "An ad-hoc task's attested evidence cannot carry ac_ref: appendEvidenceEntry resolves declared AC ids through parent_id, which is structurally a PRD for --adhoc tasks"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Reported by the implementer of `task-the-ad-hoc-task-channel-has-no-attested-evidence-path-lore` (landed 2026-08-01 as 8285d04) as a named residual gap it could not close inside its own anchors.

## What now works, and what still does not

`lore verify --task <adhoc-task>` now runs with the `<PLAN>` positional omitted and writes
GENUINELY runner-attested evidence (real `attestation.runner: "lore-cli"`, `exit_code`,
`duration_ms`). Verified end-to-end 2026-08-01.

What it still cannot do is attach `ac_ref` to those rows. `TaskWorkflowService.appendEvidenceEntry`
validates a supplied `ac_ref` by calling `resolveDeclaredAcIds(task.parent_id)`, which hard-requires
the parent to resolve to a `plan` document. For an `--adhoc` task the parent is the root PRD by
construction (SPEC-069 D2), so the check can never succeed — the same `Expected a plan document,
got type prd` family the parent task was filed to fix, one layer deeper.

## Why this still matters after the parent task closed

`ac_ref` is what makes attested evidence COUNTABLE against a spec criterion. Without it:
- `lore ac list <spec>` cannot show ad-hoc work as covering any AC — spec coverage reads as
  uncovered for ALL ad-hoc work no matter how well it was verified;
- the recovery procedure for a 0.00-attestation plan depends on reading `ac_ref` off existing
  rows (`knowledge-recovering-attestation-on-an-already-archived-plan`) — ad-hoc rows are
  invisible to it;
- the attestation floor counts rows, so this is silent: the evidence LOOKS complete.

## Required

Let `ac_ref` resolution reach a spec for an ad-hoc task. The resolution rule already exists and
is proven — `VerifyRunnerService.verifyAdhocTask` finds the governing spec by locating the ONE
spec whose `acceptance_criteria` fully covers the task`s declared `ac_scope`, refusing loud on
zero or multiple matches. ⛔ Do not duplicate that search: extract it to a single shared resolver
both call, or the two surfaces will drift into disagreeing about which spec governs a task.

## Oracle

RED first: `lore evidence <adhoc-task> --ac <AC-ID>` currently exits 4 naming the plan-type
requirement — assert that exact refusal before changing anything. GREEN: the row is stored WITH
its `ac_ref` and `lore ac list <spec>` counts it. CONTROL: an `--ac` id belonging to no spec, and
one matching multiple specs, must BOTH still refuse loud — never resolve by guessing.
