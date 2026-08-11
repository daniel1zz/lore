---
id: TASK-397
type: task
role: plan
title: "Plan membership is extra.plan_id but the last-task advisory and lore ready both query parent_id — a diverged member fires the advisory early and is attributed to the wrong plan"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: KN-248, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
## Defect (CONFIRMED by throwaway-corpus repro, 2026-08-01)

Plan membership is `extra.plan_id`, but two plan-scoped computations key on `parent_id`:

- `TaskWorkflowService.computePlanNowFullyTerminal` — `task-workflow-service.ts:1900`
  `findMany({ parent_id: plan.id, type: "task" })`
- `TaskWorkflowService.ready` — `task-workflow-service.ts:1650`, the identical query

`lore create task --plan-id P --parent Q` (both plans) is a SUPPORTED shape —
`adapters/cli/commands/create.ts:7-10` documents it verbatim: "a task parented somewhere
OTHER than its own plan passes --parent explicitly (SPEC-065 D4)". `--parent` merely
DEFAULTS to `--plan-id`. So the two fields legitimately diverge, and every consumer keyed
on `parent_id` silently drops the diverged member.

## Measured repro

Throwaway corpus (`lore init`, root PRD, no gate bypass). P3 and P4 are plans; T5 is
`--parent P3 --plan-id P3`; T6 is `--parent P4 --plan-id P3` (T6 therefore BELONGS to P3).
T6 stays `draft`. Then `lore done T5`:

| probe case | observed | expected |
|---|---|---|
| N1 — same-parent sibling still draft | advisory ABSENT | ABSENT ✓ |
| SENTINEL — all same-parent siblings terminal | advisory FIRED | FIRED ✓ (proves the probe can see the advisory at all) |
| N2 — adhoc task, parent is the root PRD not a plan | advisory ABSENT | ABSENT ✓ |
| **H — plan member parented to another plan** | **advisory FIRED while T6 is `draft`** | **ABSENT** ✗ |

Stored fields at the moment of the firing:
`T6.parent_id = <P4 id>`, `T6.extra.plan_id = <P3 id>`, `T6.status = "draft"`.

Second consumer, same root cause — `lore ready` MISATTRIBUTES rather than merely omitting:

    lore ready P3  ->  task-p3-task-in-plan          | archived | ready=false     (T6 absent entirely)
    lore ready P4  ->  task-p3-member-parented-to-p4 | draft    | ready=true      (T6 under the WRONG plan)

## Why it matters

This closes `knowledge-handoff-agent-main-orchestrator-55` KD6 ("the last-task advisory
firing while a sibling was still draft contradicts computePlanNowFullyTerminal … NOT
confirmed", confidence 50). It is confirmed, and the mechanism is not a race or a stale
read — it is a field mismatch.

Consequences beyond the advisory: a plan whose only outstanding work is a diverged member
reads as fully terminal, `lore ready` shows zero outstanding tasks, and the operator is
told to run `lore set <plan> --status archived`. The readiness number the orchestration
discipline depends on ("assert ready:false count == merged tasks") is computed from the
same query, so it inherits the error.

## Required

- Decide the SSOT for plan membership and make every plan-scoped read use it. `extra.plan_id`
  is the declared field (`--plan-id` is ALWAYS required for a non-adhoc task; `--parent`
  is optional and defaults to it), so it is the stronger candidate — but a change here moves
  `lore ready`'s result set and must be assessed against the phase-tier equivalents too.
- Cover BOTH call sites (`:1650` and `:1900`) plus any other `parent_id`-keyed plan-member
  query — grep for `findMany({ parent_id` with `type: "task"`.
- Check the phase tier (`phase-workflow-service.ts`) for the same shape.

## Oracle

- RED first: a test reproducing case H above must fail before the fix (advisory fires with
  a draft member) and pass after.
- `lore ready P3` lists T6; `lore ready P4` does NOT.
- CONTROLS, so the fix cannot simply widen everything: N1, N2 and SENTINEL above keep their
  current verdicts, and a plain same-parent plan's `ready` result set is byte-identical.


## Proxy / Silence / Opt-in — ADR three-question review (2026-08-01, agent:main-orchestrator)

Answered per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` BEFORE
implementation. Binding on the implementer: a fix that does not satisfy all three is not done.

**Q1 Proxy — the gap CLOSES; this is the only one of the seven filed defects where it does.**
`parent_id` is a proxy for plan membership; `extra.plan_id` IS the property — it is the field
`--plan-id` writes, and it is mandatory for every non-adhoc task. Switching both queries to
`extra.plan_id` therefore replaces a proxy with the property rather than trading one proxy for
another. Concrete input satisfying the proxy while violating the property — MEASURED, case H
above: `T6.parent_id = P4`, `T6.extra.plan_id = P3`. No input satisfies `extra.plan_id == P`
while T6 is not a member of P, because membership is DEFINED by that field. No residual gap
is accepted because none remains.

**Q2 Silence — must be made loud. This is scope the Required section above does NOT state.**
After the switch, a task with no `extra.plan_id` (adhoc) is excluded from every plan's member
set. Correct — but the terminality computation must not read "zero members" as "all members
terminal". A plan whose `extra.plan_id` query returns EMPTY while a `parent_id`-keyed query
returns NON-EMPTY is a contradiction, and today that state fires the last-task advisory.
Required: report the disagreement explicitly rather than silently trusting either side.
⛔ Do NOT resolve it by unioning the two sets — a union re-admits the misattribution this task
exists to remove.

**Q3 Opt-in — clean.** Both call sites (`:1650`, `:1900`) run unconditionally for every plan.
No flag, no declaration, nothing to forget.

**⛔ Concurrency note — RE-MEASURE before dispatch; do not trust this paragraph.**
Between 21:19 and 21:41 on 2026-08-01 a CONCURRENT orchestrator session — resolving to the SAME
`agent:main-orchestrator` actor as this review's author, so invisible in `active_sessions` — ran
four agents in `.claude/worktrees/agent-{a0bd2615…, a313f70c…, a63979673…, adcccee23…}` and merged
two of them into `main` mid-review: `main` moved `63c3537` → `955c26d` in four minutes.
The files this task must touch were inside that window's write set:
- `packages/lore/src/service/task-workflow-service.ts (both call sites, `:1650` and `:1900`)`

⛔ Whether they are STILL contended is not knowable from this document. `--porcelain` and
ahead-counts are not durable facts — the first version of this very paragraph asserted
"uncommitted, branch empty" about worktrees that were merged before it was four minutes old.
Before dispatching, re-measure:

    git worktree list && git log --oneline -3
    for w in $(git worktree list --porcelain | awk '/^worktree/{print $2}'); do \
      printf '%s: %s dirty, %s ahead\n' "$w" \
        "$(git -C "$w" status --porcelain | wc -l)" \
        "$(git -C "$w" log --oneline main..HEAD 2>/dev/null | wc -l)"; done

Then re-read the MERGED state of the files above: a landed concurrent change may have moved the
seam this task's fix targets. See `task-lore-handoff-reports-modified-files-none-while-four`.
