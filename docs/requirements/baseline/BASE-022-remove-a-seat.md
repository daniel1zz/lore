---
id: BASE-022
type: baseline
role: intent
title: "Remove a seat"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-027
---
## Remove a seat

> A session gives back a plan's seat once its work is merged, and anyone can list the seats and see which are merged.

Scope: removing a seat, guarding the removal of any worktree of the repository against someone still working in it, and listing seats. Taking and returning to a seat is "Enter a seat".

### Behaviour

**Command.** A session removes the seat of a plan, optionally forcing it; or lists every seat.

**Constraint.** Removal is refused while the seat's branch has work not in main, unless forced (BR-374); a branch merged into main, also by a squash merge, needs no force (BR-375). Force also discards uncommitted changes in the seat (BR-377). Force does not help in a repository with no branch named main: there the merge check fails first and no seat can be removed (BR-379). A failed git step fails the removal (BR-378). Removing any worktree of the repository, a seat or not, that is clean and merged is refused while its agent run or that run's parent has not ended, while a process other than the remover's stands inside it, while an open claim on it belongs to a live run, or while it belongs to another session that is still live and may resume its agent; it is allowed as soon as none holds, however recent its last commit, and a signal that cannot be measured refuses and says so (BR-1070). Archiving a task removes the worktree its claim recorded, and a sweep removes any other, by exactly that test (BR-1079).

**Event.** `SeatRemoved`: the seat's worktree is removed in git and its branch is kept (BR-376); nothing is written to the corpus (BR-375). Listing shows every seat with whether it is merged (BR-380), or fails without a partial list (BR-381).

### Terms used here

- **Seat**: defined in the branch glossary.

### Boundary notes

- A kept seat branch shows as unowned in the territory (BR-391).
- Removing any worktree of the repository, a seat or not, is guarded by who is still working in it, never by how long it has been quiet (BR-1070); whether a run has ended is "Attribute work to a run".
- When a task is archived is execution's ("Archive a task"); this leaf only says what archiving does to the task's recorded worktree (BR-1079).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Branch a seat must be merged into | main | engineering (code) | 2026-10-09 |

### Depends on

- Enter a seat: the seats removed.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The command says it removes the worktree and the branch; only the worktree is removed. Which is meant? | unconfirmed | engineering |
| Q2 | Merged always means merged into a branch called main. Should the integration branch be configurable? | undecided | product |
| Q3 | No criterion cites BR-375 (a branch merged into main, also by squash, is removed without force). Which criterion, with a test that fails if the rule is false, should establish it? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-375 | unconfirmed | established | Q3: no question about intent; no criterion cites it yet. |
| BR-376 | unconfirmed | undecided | Should removing a seat also delete its branch? |
| BR-377 | unconfirmed | established | Should one flag cover both losses, unmerged commits and uncommitted changes? |
| BR-378 | unconfirmed | established | Should removing an already removed seat succeed quietly, and should the message name removal? |
| BR-379 | unconfirmed | undecided | Should the integration branch be the repository's own default, and should force skip the merge check entirely? |



**Held at unconfirmed after the 2026-10-09 citation audit:** BR-381. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
