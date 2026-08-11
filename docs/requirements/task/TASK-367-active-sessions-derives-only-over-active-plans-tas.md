---
id: TASK-367
type: task
role: plan
title: "active_sessions derives only over ACTIVE plans' tasks — with 0 active plans and adhoc tasks parented to the PRD, the field is unconditionally empty, and an orchestrator read that [] as 'nobody is working' before removing a live agent's worktree"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-04
tags: []
parent: PRD-001
links:
  - {id: KN-215, type: relates-to}
---
`active_sessions` is the one field an orchestrator consults before touching another agent's
worktree, and it is currently **incapable of ever being non-empty**. It reported `[]` while a
live implementer held a fresh-authored claim and was committing; on the strength of that `[]`
the orchestrator removed that agent's worktree directory out from under it.

## Measured 2026-08-02 by the orchestrator

    session-service.ts:282-285
      const activeTasks = allDocs.filter(
        (d) => d.type === "task" && d.parent_id !== null && activePlanIds.has(d.parent_id),
      );
      const activeSessions = deriveSessions(activeTasks, nowIso, this.deps.claimTtlMinutes);

Corpus state at the time of measurement:

| quantity | measured |
|---|---|
| plans by status | **114 archived, 0 active** |
| `activePlanIds` | **empty** — so `activeTasks` is empty, so `active_sessions` is `[]` unconditionally |
| the live agent's task `parent_id` | `01KVZ4C445EK479938W1TYT3AJ` = the **root PRD**, not a plan |
| that task's claim | `by: agent:ns6-assess-registry`, worktree set, task `draft`, `extra.adhoc: true` |
| bootstrap `active_sessions` | `[]` |
| that agent's git activity | two commits, the later one **90 seconds** before the read |

So the field failed **twice over**, and either failure alone is sufficient:

1. **Zero active plans.** Every plan in this corpus is archived. `activePlanIds` is empty, so the
   filter yields nothing and `deriveSessions` is handed an empty array. The field is inert for the
   entire corpus, for every caller, right now — not "sometimes wrong", but never able to report a
   session at all.
2. **Adhoc tasks are parented to the root PRD, never to a plan.** `--adhoc` (SPEC-069 D2) exists
   precisely to create planless tasks. They can therefore NEVER satisfy `activePlanIds.has(parent_id)`,
   so even restoring an active plan would leave every adhoc claim invisible. Adhoc is now the
   dominant task shape here.

## Root cause — a documented corpus-global field implemented plan-scoped

The shipped bootstrap contract states the field's scope explicitly:

> SCOPE: this payload is a corpus-global snapshot spanning every plan, every actor, and every
> concurrent session.

and names `active_sessions` as one of those corpus-global fields. The implementation intersects
with `activePlanIds`. **The contract says corpus-global; the code says plan-scoped.** Those are not
reconcilable, and the divergence resolves in the fail-quiet direction: an empty array is
indistinguishable from a truthful "nobody is working."

This is the same structural pattern already recorded in
`knowledge-handoff-agent-main-orchestrator-71` KD3 — plan-close is structurally inert for
`extra.adhoc` tasks because it keys off a plan that does not exist. Two independent mechanisms have
now failed the same way. ⛔ Fixing only this one leaves the pattern live; the fix must say what
makes plan-scoped derivations safe in an adhoc-dominant corpus, or enumerate the remaining ones.

## Second half — a claim's timestamp is not a liveness signal, and nothing else is either

`claim.at` is written once at claim time and never refreshed while the agent works. The incident's
agent claimed 20 hours before it was still actively committing, so its lease read
`age 1203 min` against `claim_ttl_minutes: 120` — i.e. `stale: true`, ten times over — while the
process was demonstrably alive. `isClaimStale` is honest about what it measures (lease age), but
there is no other signal in the corpus, so a reader with a decision to make will use it as one.

The only reliable liveness evidence available during the incident was **outside lore entirely** —
`git reflog show <branch> --date=iso`, which timestamped a commit 90 seconds old. A knowledge
platform whose session view is answered by `git reflog` has ceded the question.

⛔ Do not "fix" this by lengthening `claim_ttl_minutes`. That is the timeout-tuning anti-pattern:
it moves the false-death threshold without making staleness mean liveness, and it simultaneously
delays genuine lease reclamation. Either surface a real liveness signal or make the field's
inability to answer liveness explicit at the point of consumption.

## Blast radius

`active_sessions` is consumed at the highest-leverage, least-recoverable moment there is: a fresh
session reads it to learn who else is working **before** it claims, reclaims, or cleans up. The
failure mode is not a wrong number on a report — it is destructive action taken against a live
peer's working directory. In this incident the branch's commits survived only because
`git worktree remove` (correctly) refuses a dirty tree and the agent had just committed; a removal
30 seconds earlier would have hit uncommitted work.

## Required

1. Make `active_sessions` mean what its shipped contract says: derive over **every task carrying a
   claim**, corpus-wide, regardless of parent type or parent status. Keep the plan-scoped
   `sessions[]` in `TaskWorkflowService.ready` as-is — that one is *correctly* plan-scoped and is
   not the defect; the two must stay distinguishable rather than being collapsed into one helper
   with a flag.
2. Decide and record what a `stale: true` claim means to a consumer, given that staleness provably
   does not imply death. Weigh at least: (a) keep reporting stale claims in `active_sessions` with
   the flag, so a reader sees a claimant exists at all — the incident's minimum viable fix;
   (b) refresh `claim.at` on evidence writes, making lease age a weak-but-real activity proxy —
   state what still goes unrefreshed; (c) surface an explicit `liveness: "unknown"` so the field
   stops implying an answer it cannot give. ⛔ Do not silently pick one.
3. Address the pattern, not just this site: state what prevents the next plan-scoped derivation
   from going inert on adhoc tasks, or enumerate the ones that already have.
4. `knowledge-handoff-agent-main-orchestrator-71` NS3 records a SEPARATE defect in this same
   derivation — retracted tasks' claims are not excluded. Do not fix it silently as a side effect
   and do not regress it; say explicitly which one you touched.

## Oracle

- **NEGATIVE (load-bearing — fails today)**: in a throwaway corpus with **zero active plans**,
  create an adhoc task, claim it, and assert `lore bootstrap --json` reports that session in
  `active_sessions`. This is the exact incident shape and it returns `[]` today.
- **NEGATIVE**: a *fresh* claim on a task under an **archived** plan also appears. Today it does not.
- **HAPPY / REGRESSION**: a claim under an active plan still appears, with `by` / `machine` /
  `worktree` / task grouping byte-identical to today's shape for that case.
- **REGRESSION**: `TaskWorkflowService.ready`'s plan-scoped `sessions[]` is UNCHANGED — assert it
  still excludes tasks outside the queried plan. Widening both is a real risk of a shared-helper fix.
- **BOUNDARY**: a claim whose `parent_id` resolves to nothing (broken ref / hard delete) does not
  throw and does not silently vanish.
- **CONTROL (anti-false-oracle)**: prove the new assertion can fail — revert the filter to the
  plan-scoped form in a scratch copy and confirm the NEGATIVE case reds. A test that passes because
  the fixture accidentally had an active plan would be green while testing nothing.
- ⛔ Never write to this repo's own `.lore/`: use `mkdtemp` + `lore init` per the canonical pattern
  in `packages/dashboard/tests/e2e/global-setup.ts`.

## Provenance

Filed 2026-08-02 from a live incident during the resumption of
`knowledge-handoff-agent-main-orchestrator-70`. The orchestrator read `active_sessions: []`, misread
`git branch --merged` output, and removed a live agent's worktree. The worktree was restored from the
branch tip within two minutes with no source loss (the tree was clean, so `git worktree remove`
succeeded without `--force`; only gitignored `node_modules` was lost, and was reinstalled). The
operator error is real and separately recorded, but the field that was supposed to prevent it could
not have prevented it under any circumstances — that is what this task is for.


## Dispatch addendum — appended 2026-08-04 by agent:main-orchestrator

The Oracle section above IS this task's acceptance contract and is authoritative as written; it was
left in prose form deliberately because each bullet already names its dimension and its
falsifiability condition. Two things it does not state, added here rather than by rewriting it:

**Six-dimension mapping** (the Oracle bullets already carry four; these are the two to add):

- ERROR — a claim whose `worktree`/`machine` fields are absent or malformed is reported, not
  dropped: a session you cannot fully describe is still a session someone is running.
- STATE — a task claimed, then RELEASED, must disappear from `active_sessions`; a task claimed,
  then ARCHIVED via `lore done`, likewise. Assert both transitions, since the widened derivation
  now sees tasks it previously filtered out by parent status and could otherwise resurrect
  terminal ones.

**Toolchain floor**: `bun run typecheck` clean, and `bun run test:changed <base>` passing with a
NON-ZERO selection (loud-zero rule: a non-empty changed-file set selecting 0 tests exits 1 and is a
defect in test naming, never a pass).

⛔ Required #2 demands a RECORDED decision about what `stale: true` means to a consumer. State it in
the module JSDoc and in the completion report — the three candidates (a/b/c) are listed above, and
picking one silently fails this task.

⛔ Required #4 warns that `knowledge-handoff-agent-main-orchestrator-71` NS3 records a SEPARATE
defect in this same derivation (retracted tasks' claims are not excluded). That one just became more
consequential: measured 2026-08-04, `lore list` does not exclude invalidated docs on either surface
and `--include-invalid` is silently inert — filed as
`task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in`. So a retracted task's claim is
invisible-as-retracted to every machine consumer. Say explicitly which of the two you touched; do
NOT silently fix both.
