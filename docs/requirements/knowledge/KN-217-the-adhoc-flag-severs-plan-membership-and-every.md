---
id: KN-217
type: knowledge
role: knowledge
title: "The --adhoc flag severs plan membership, and every governance predicate keyed on plan membership silently goes inert — the ad-hoc attestation path already ships"
status: approved
priority: medium
created: 2026-08-02
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: TASK-376, type: informs}
  - {id: TASK-384, type: informs}
---
# `--adhoc` severs plan membership, and every governance predicate keyed on plan membership silently goes inert

Supersedes the framing carried in `knowledge-handoff-agent-main-orchestrator-71` NS1,
whose premise ("`lore verify` is STRUCTURALLY unable to produce an attestation for an
ad-hoc task, so `--override-attestation` is unavoidable") is **refuted by shipped code**.

## The premise is false — both halves of the ad-hoc attestation path already ship

Measured 2026-08-02 against `main` @ `80a3ace`:

- `VerifyRunnerService.verifyAdhocTask` exists and is reached from the CLI —
  `packages/lore/src/adapters/cli/commands/verify.ts:459`. The `<PLAN>` positional is
  declared `required: false` (`verify.ts:319-323`) precisely to open this path
  (SPEC-069 D2, `task-the-ad-hoc-task-channel-has-no-attested-evidence-path-lore`).
  It resolves the ONE spec whose `acceptance_criteria` fully declares the task's
  `extra.ac_scope` ids, then runs the **identical** shared pipeline `<PLAN>` mode runs —
  real command execution, real `attestation.runner`/`exit_code`/`duration_ms`.
- The `ac_ref` follow-up the same module header describes as an open gap
  (`verify.ts:118-126`) is **also closed**: `resolveAdhocGoverningAcIds` is a real port on
  `TaskWorkflowService` (`task-workflow-service.ts:841-860`), implemented by
  `CorpusService.resolveDeclaredAcIdsForAdhocTask` and **wired at both composition sites**
  (`app.ts:637`, `app.ts:968`). An ad-hoc task's attested evidence can carry `ac_ref`.

⛔ `verify.ts:118-126` is therefore STALE — it documents a gap that a later slice closed.
A reader (human or AI) budgeting work off that header will re-derive the handoff's wrong
conclusion, which is exactly what happened.

## The real mechanism root

Both mechanisms unlock only when the ad-hoc task declares `extra.ac_scope`. And the flag
that populates it is required by a predicate ad-hoc tasks **structurally cannot satisfy**:

> `--ac-scope` … "Required (may be empty) when **the parent plan's spec** declares >= 1
> script-mode AC" — `lore create --help`

`--adhoc` is documented as "parented to the corpus root PRD **instead of a plan**" and is
mutually exclusive with `--plan-id`. There is no parent plan, so there is no parent plan's
spec, so the requiredness predicate never fires. The one flag that unlocks the attestation
path is gated on the one condition `--adhoc` guarantees is absent.

**Measured consequence** (25 most recent ad-hoc tasks sampled via `lore list --type task`):
**24 of 25 carry `ac_scope: null`.** The single exception
(`task-ac-acs-1-and-ac-acs-9-are-still-compound-after-the-split`) declares five ids — and
it is the one task whose author happened to be reasoning about ACs.

With `ac_scope` absent, `verifyAdhocTask` has nothing to resolve a governing spec from, so
no attestation can be produced, so `lore done`'s attested-pass floor cannot be satisfied,
so `--override-attestation` becomes the routine path. The audit trail confirms it fired,
with the reason string literally beginning `"Ad-hoc task (extra…"` (19 override mentions
across the last 400 audit rows).

## This is the SAME shape as the handoff's KD3, not a second incident

KD3 recorded: *"plan-close 对 extra.adhoc 任务结构性失效（无 plan 则永不触发）"*. That is
the same defect class, on a different predicate. Enumerated so far:

| # | Mechanism | Predicate keyed on | Effect on an ad-hoc task |
|---|---|---|---|
| 1 | `plan-close` gate | plan membership | never fires (KD3, observed 3×) |
| 2 | `--ac-scope` requiredness | parent plan's spec | never fires → attestation path unreachable → `--override-attestation` routine |
| 3 | `verify.ts` header's `ac_ref` claim | `task.parent_id → plan` | was true, since closed — the DOC is what went stale |

⛔ The transferable lesson: `--adhoc` was introduced as a *parenting* convenience, but
plan membership is load-bearing for an unbounded set of governance predicates. Every
predicate that reads plan membership silently degrades to "inert" rather than "refuse" —
there is no place where a mechanism announces that it opted out. The escape hatch then
looks like a tool defect ("attestation is impossible for this task class") instead of what
it is (a predicate that never armed).

## What follows from this — and what does NOT

- The choice the handoff framed ("design a real attestation path" vs "explicitly exempt
  ad-hoc tasks") is a **false dilemma**. The path exists; neither branch is the work.
- Do NOT exempt ad-hoc tasks from the attested-pass floor. They would lose all three
  mechanisms above at once, and the class is not marginal — it is currently the DOMINANT
  task shape in this corpus.
- The fix is to re-key requiredness so it fires on the ad-hoc branch too: an ad-hoc task
  must declare `--ac-scope` explicitly (possibly empty, the same "explicit empty" contract
  the plan branch already has). An explicitly-empty declaration is an auditable statement
  that this task claims no criterion; a silently-absent one is indistinguishable from an
  author who never knew the flag applied.
- ⛔ The generalisable guard, not the point fix: an `--adhoc`-shaped flag that severs a
  structural edge needs an enumeration of the predicates reading that edge, and each must
  choose refuse-or-rekey **explicitly**. Silent inertness is the defect; the three
  instances above are its symptoms.
