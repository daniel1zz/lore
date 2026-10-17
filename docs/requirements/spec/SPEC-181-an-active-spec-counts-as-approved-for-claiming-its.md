---
id: SPEC-181
type: spec
role: spec
title: "An active spec counts as approved for claiming its tasks and approving plans under it"
status: approved
priority: high
created: 2026-10-15
updated: 2026-10-17
tags: [lifecycle, gates]
links:
  - {id: TASK-1246, type: resolves}
---
# Spec: An active spec counts as approved for claiming its tasks and approving plans under it

Resolves #52. Owner decision 2026-10-15: work under an `active` spec must stay claimable.

## Overview/Goal

`UPSTREAM_APPROVED_STATUSES = new Set(["approved"])` (`packages/core/src/task-workflow.ts:1071`) is the one set behind three checks: the task-claim / phase-claim gate (`packages/lore/src/service/gate-predicates.ts:285`), plan-promote, and the readiness advisory (`task-workflow.ts:1378`, `adapters/cli/task-feed-wiring.ts:345`). A spec that moves `approved → active` therefore freezes every descendant claim and every new plan under it (UPSTREAM_NOT_APPROVED), although `active` is the lifecycle's next live state (`VALID_TRANSITIONS`: approved → active → archived).

The JSDoc's reason for excluding `active` — "a spec can be active-but-being-revised" — no longer holds: a spec is a `record` (`packages/core/src/doc-standing.ts`), so a settled spec is locked and cannot be revised in place; revising it means `lore reopen` (back to draft, which correctly blocks again) or a new spec.

## Scope

- `UPSTREAM_APPROVED_STATUSES` becomes `{"approved", "active"}`; its JSDoc and the `gate-predicates.ts:248-257` comment state the new reason (record lock) and cite this spec.
- No other status is added: `draft`, `in-review`, `archived`, `deprecated` keep refusing.
- BR-104 is restated; BR-111's "unapproved" follows the same set.

Out of scope: any other lifecycle change.

## Acceptance Criteria

Declared with `lore ac add` (AC-ACT-*).


## Acceptance Criteria (structured)

- [⚑] [script] AC-ACT-1: In a throwaway corpus with a spec moved approved -> active: lore claim on a task of a plan under it is not refused for its upstream, lore approve of a new plan under it is not refused for its upstream, and lore ready shows no unapproved-spec warning flag on its tasks; with the same spec reopened to draft, the claim and the plan approval are refused with UPSTREAM_NOT_APPROVED (exit 4) and the flag returns; in-review is refused the same way.
  script: test — out=$(mktemp) && bunx --bun vitest run packages/lore/tests/integration/gates/active-spec-counts-as-approved.bun.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 6 ] && echo 'AC-ACT-1 PASS: active clears claim, plan approval and the readiness flag; draft and in-review still refuse with UPSTREAM_NOT_APPROVED'
- [⚑] [script] AC-ACT-2: UPSTREAM_APPROVED_STATUSES contains exactly approved and active, and gate-predicates.ts and task-feed-wiring.ts import it instead of building their own status set.
  script: test — cd /Users/apple/Projects/zz/lore && grep -nE "UPSTREAM_APPROVED_STATUSES[^=]*= new Set\(\[\"approved\", \"active\"\]\)" packages/core/src/task-workflow.ts && ! grep -rnE "new Set\(\[\"approved\"\]\)" packages/lore/src/service/gate-predicates.ts packages/lore/src/adapters/cli/task-feed-wiring.ts && grep -q "UPSTREAM_APPROVED_STATUSES" packages/lore/src/service/gate-predicates.ts && grep -q "UPSTREAM_APPROVED_STATUSES" packages/lore/src/adapters/cli/task-feed-wiring.ts && echo "AC-ACT-2 PASS: one status set {approved, active} shared by the claim gate and the readiness feed"

## Code anchors

- packages/core/src/task-workflow.ts#UPSTREAM_APPROVED_STATUSES
- packages/lore/tests/integration/gates/active-spec-counts-as-approved.bun.test.ts
