---
id: SPEC-107
type: spec
role: spec
title: "Plan closure must be loud — terminality divergence, silent demotion, absence-as-assertion"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-10-17
tags: [governance, plan-close, gates]
links:
  - {id: SPEC-208, type: implements}
---
# Spec: Plan closure must be loud — terminality divergence, silent demotion, and absence-as-assertion

## Overview/Goal

Three defects, one essence: **when the system lacks information or a loop is left unclosed, it currently goes silent or asserts confidently — instead of saying so.** Each was demonstrated live on 2026-07-28 (see `knowledge-session-process-review-2026-07-28-dashboard`), where a plan was reported closed while its own doc sat in `draft`, the `plan-close` gate consequently never evaluated it, and when finally driven through, that gate's remediation text told the operator a provable falsehood that would have corrupted a correct corpus.

This spec makes all three loud. It deliberately does NOT add auto-magic (no auto-closing plans, no auto-promotion) — the fix for silence is *speech*, not *guessing*.

## Scope

In:
- **G-A Terminality divergence is detectable and announced.** A new corpus drift kind for "every child task is terminal but the plan is not", surfaced by `lore status --check-tree` (already run by `hooks/pre-push`), plus a `lore done` advisory at the exact moment the last non-terminal task of a plan is archived.
- **G-B Unrequested status side effects are surfaced.** `CorpusService.set`'s approved→draft auto-demotion is reported on EVERY surface, not only the AI-mutation CLI branch.
- **G-C Absent gate-context facts must never render as asserted facts.** `plan-close` populates the reachability inputs it already has in hand; and the reachability describer distinguishes *unknown* from *known-false* so no feeding pack can ever again state a definite negative from a missing optional field.

Out: auto-closing plans on last-task-done (a gate may legitimately deny; `done` must not fail for reasons unrelated to its task); changing `VALID_TRANSITIONS`; changing the attestation ratio default; any dashboard surface.

## Design Decisions

### DD-1 (G-A) Detector lives in TreeCheckService as a new drift kind, NOT a new `--check-*` flag

`DriftKind` gains `"plan-terminality"`: a `plan` doc whose status is non-terminal (not `archived`/`deprecated`) while it has ≥1 child task and ALL child tasks are terminal. Rationale for reusing `--check-tree` rather than adding `--check-plan-terminality`: `hooks/pre-push` already runs `--check-tree --check-drift`, so the check is armed for every consumer on day one with no hook edit and no per-consumer opt-in (distribution-first). A separate flag would ship dark.

⛔ `lore status --fix` MUST NOT auto-fix this drift kind. `--fix` today repairs `orphan`/`misplaced` (pure structure). Auto-transitioning a plan to `archived` would fire the `plan-close` gate from inside a repair command and could silently satisfy — or noisily fail — a governance checkpoint the operator never invoked. The drift is reported with the exact command to run; the human/agent decides.

Boundary cases that MUST NOT report drift: a plan with zero tasks (nothing computed to be done); a plan with any non-terminal task; an already-terminal plan.

### DD-2 (G-A) `lore done` announces last-task closure, does not perform it

When `done` archives a task and that task was the LAST non-terminal task of its plan, print a stderr advisory naming the plan slug and the literal next command (`lore set <plan> --status archived`), stating that the `plan-close` gate will evaluate it. Follows the established once-per-process advisory precedent in `adapters/cli/utils.ts::resolveActorWithIdentitySource` (stderr, ⚠ prefix, actionable). Not once-per-process here — it is per-plan-completion and rare.

The advisory is CLI-layer only; `TaskWorkflowService.done` gains the *fact* in its result (`plan_now_fully_terminal?: { plan_slug }`), so MCP/HTTP can render it too, but the service performs no plan write.

### DD-3 (G-B) Demotion is a returned fact, surfaced everywhere

`CorpusService.set` already computes `isApprovedAutoResetToDraft`. Today it is an internal side effect: no field on the result signals it, and only the CLI's `--regenerate/--refine` branch prints anything. Fix: carry it on the result (e.g. `auto_demoted_from_approved: true`) and print the advisory on the STANDARD patch path too (`--content/--content-file/--title`). The AI-branch message text is reused verbatim so the two paths cannot drift.

Rationale (the live failure): the CLOSE-phase discipline of appending closure addenda to an approved plan is precisely what de-promoted it, silently — a discipline whose correct execution reverses a prior gate promotion without saying so is a trap. Surfacing the fact is the minimum; it also lets the operator immediately re-approve.

### DD-4 (G-C) Thread the facts plan-close already holds; make absence unrepresentable as assertion

Two-part, both required:

(a) **Populate**: `plan-close`'s `GateContext` currently starts as `{ targetIdOrSlug }` and never sets `hasSpecParent` / `parentSpecScriptAcCount`, even though `getPlanBundle` has already resolved `bundle.spec` for the prd-sync branch. Thread them from that same bundle.

(b) **Make the false claim impossible, not merely unlikely**: `verifyReachability(planParentType, parentSpecScriptAcCount)` returns `why: "parent-not-spec"` for ANY `planParentType !== "spec"` — including `undefined`, i.e. "caller did not tell me". `describeReachabilityWhy` then renders that as the definite claim *"this plan has no spec-tier ancestor at all"*. Absence of evidence is rendered as evidence of absence. Add a third outcome (`why: "unknown"` / reachability `null`) for the not-supplied case, and either omit the reachability paragraph entirely or state that reachability could not be determined. A gate MUST NOT assert a corpus fact it was never given.

⛔ Do not "fix" this by only doing (a). (a) repairs today's call site; (b) removes the whole class — any future checkpoint that forgets to populate an optional field must degrade to silence, never to a confident falsehood. The live incident's real damage was that both offered remedies (reparent the plan / declare `attestation_exempt_kind: "pipeline-unreachable"`) would have corrupted a correct corpus.

## Failure Modes

| Failure | Detection | Behavior |
|---|---|---|
| Plan fully terminal, never closed | `--check-tree` drift + `done` advisory | Reported with exact command; never auto-fixed |
| Plan with 0 tasks | DD-1 boundary | No drift (vacuous) |
| `--fix` run against terminality drift | DD-1 guard | Left unfixed, reported |
| Approved doc demoted by a content edit | DD-3 | Advisory on stderr + fact on the result; write still succeeds |
| plan-close ctx missing reachability inputs | DD-4(b) | Remediation omits/qualifies the claim; never asserts "no spec-tier ancestor" |
| Plan genuinely parented to a non-spec | DD-4(a) populated, reachability false | Existing accurate message retained |

## Acceptance Criteria

(structured ACs declared via `lore ac add`)

## Consumer contracts

- implement: `packages/lore/src/service/tree-check-service.ts` (DriftKind + detector), `packages/lore/src/service/task-workflow-service.ts` (done result field), `packages/lore/src/adapters/cli/commands/done.ts` (advisory), `packages/lore/src/service/corpus-service.ts` (demotion fact + plan-close ctx threading), `packages/lore/src/adapters/cli/commands/set.ts` (standard-path advisory), `packages/lore/src/service/gate-predicates.ts` (`verifyReachability` unknown case), `packages/lore/src/service/checkpoint-registry.ts` (`describeReachabilityWhy`).
- test: six-dimension coverage; every AC bound to a named command. Regression anchor: the live 2026-07-28 case (plan parented to an approved tech spec with 8 script ACs must NEVER produce "no spec-tier ancestor").
- deploy: none; `hooks/pre-push` picks up DD-1 automatically via the existing `--check-tree`.


## Acceptance Criteria (structured)

- [⚑] [script] AC-CLOSURE-1: TreeCheckService reports a plan-terminality drift when a plan is non-terminal and has >=1 child task with ALL child tasks terminal; and reports NO drift for (a) a plan with zero tasks, (b) a plan with any non-terminal task, (c) an already-archived plan
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/tree-check-service.bun.test.ts -t "plan-terminality"
  other_command=11
- [⊘] [script] AC-CLOSURE-2: lore status --check-tree surfaces plan-terminality drift with a nonzero exit, and lore status --check-tree --fix leaves it UNFIXED (auto-transitioning a plan would fire plan-close from inside a repair command)
  script: test — bunx vitest run packages/lore/tests/integration/cli/check-tree.test.ts -t "plan-terminality"
  other_command=2
- [⚑] [script] AC-CLOSURE-3: lore done on the LAST non-terminal task of a plan emits a stderr advisory naming the plan slug and the literal command 'lore set <plan> --status archived'; done on a non-last task emits none; the service performs no plan write in either case
  script: test — bunx vitest run packages/lore/tests/unit/cli/done-command.test.ts -t "last non-terminal task"
  other_command=5
- [·] [script] AC-CLOSURE-4: CorpusService.set carries the approved-to-draft auto-demotion as a fact on its result, and lore set prints the demotion advisory on the STANDARD patch path (--content/--content-file/--title), not only the AI --regenerate/--refine branch
  script: test — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-set-demotion-advisory.bun.test.ts
  other_command=14
- [⊘] [script] AC-CLOSURE-5: verifyReachability distinguishes unknown (caller supplied no parent type) from known-false (parent type supplied and is not a spec); describeReachabilityWhy never renders the definite claim 'no spec-tier ancestor' for the unknown case
  script: test — bunx vitest run packages/lore/tests/unit/service/checkpoint-registry.test.ts -t "reachability unknown"
  other_command=1
- [·] [script] AC-CLOSURE-6: REGRESSION (live 2026-07-28 case): a plan whose parent IS an approved tech spec declaring >=1 script-mode AC, closed via lore set --status archived, NEVER produces remediation text containing 'no spec-tier ancestor' — plan-close threads hasSpecParent and parentSpecScriptAcCount from the already-resolved plan bundle
  script: test — bunx --bun vitest run packages/lore/tests/integration/plan-close-reachability.bun.test.ts
  other_command=11
