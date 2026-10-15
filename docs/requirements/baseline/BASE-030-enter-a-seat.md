---
id: BASE-030
type: baseline
role: intent
title: "Enter a seat"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-15
tags: []
parent: BASE-027
links:
  - {id: SPEC-095, type: supersedes}
---
## Enter a seat

> A session takes a worktree of its own for one plan, so its work stays out of the main checkout and other sessions can see which plan it is on.

Scope: taking a seat and returning to an existing one, and the agent-level counterpart of a seat: a code- or test-writing helper agent must start in a working copy of its own (BR-1023). Both rules serve the same purpose, keeping writing work out of the shared main checkout. Removing and listing seats is "Remove a seat".

### Behaviour

**Command.** From the main checkout, a session takes a seat for a plan, or returns to the existing seat of a plan.

**Constraint.** The main checkout must have no uncommitted change (BR-367). It is brought up to date with its upstream first, when it has one (BR-368). The plan must have no open conflict between claims on the same files (BR-369). Returning needs an existing seat (BR-372). A plan name that matches nothing is not found (exit 3), and returning without naming a plan is a usage error (exit 2) (BR-373). A failed git step fails the request as a storage failure (exit 1) and nothing done so far is undone (BR-371).

**Helper agents.** Where a project registers the shipped dispatch-isolation hook, starting a code- or test-writing helper agent (`lore-implementer`, the only shipped write type; test-writing work uses it too) without its own working copy is refused with exit 2, naming the helper type and the isolation seen (`<absent>` when none). Read-only helpers, the general helper, isolated helpers and unreadable input pass; a base behind another branch only warns. Nothing is written to the corpus (BR-1023). Read in `assets/hooks/pre-dispatch-isolation-gate.mjs:59-93` (refusal) and `:138-143` (failures in the base check let the dispatch through), 2026-10-10.

**Event.** `SeatEntered` (a worktree and branch in git; nothing in the corpus).

### Terms used here

- **Seat**, **main checkout**: defined in the branch glossary.

### Boundary notes

- BR-373 also covers removing a seat (not found, usage error). It is held here as one rule because one name lookup serves all three commands; "Remove a seat" relies on it for its own not-found and usage refusals.
- Installing and registering the dispatch-isolation hook is **distribution**'s: `lore setup` ships the file (listed in `packages/lore/src/generated/assets-manifest.ts:68`) but no shipped settings file registers it, so a project opts in by registering it. This leaf holds only what the hook refuses once registered.
- File-anchor conflicts between claims are defined by execution ("Claim a task"); this leaf only refuses on them.
- A session opened inside a seat gets a seat-scoped resume pointer (BR-327) and a seat briefing (context).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Where a seat is created | beside the main checkout, named after the repository and the plan | engineering (code) | 2026-10-09 |

### Depends on

- execution, "Claim a task": the anchor conflicts consulted.
- Remove a seat: the way out.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A seat can be taken for a document that is not a plan, and the conflict check then passes silently. Should taking a seat require a plan? | unconfirmed | engineering |
| Q2 | Untracked files count as uncommitted changes, so a checkout with stray files can never take a seat. Intended? | undecided | product |
| Q3 | The dispatch-isolation hook is shipped but not registered, so a project is protected only if it opts in (BR-1023). Should `lore setup` register it? | undecided | product, distribution |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-1023 on 2026-10-10), but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`); `observed` is used for a rule measured in code that no criterion checks yet.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-366 | unconfirmed | established | None about intent; the tests check that a worktree is created but not where or on which branch. |
| BR-368 | unconfirmed | established | Should taking a seat change the main checkout at all, and should it happen before the conflict check that may refuse the seat? |
| BR-369 | unconfirmed | established | None about intent; the refusal itself is tested, but no criterion tests that taking a seat consults it. |
| BR-370 | unconfirmed | undecided | Should taking a seat require the target to be a plan? |
| BR-373 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-1023 | observed | established | Read from the shipped hook's code (observed: measured in code, no criterion yet). Q3: should `lore setup` register the hook by default? Established once a check-decided criterion drives the hook with a writing helper and no isolation and fails if it is let through. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-372. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
