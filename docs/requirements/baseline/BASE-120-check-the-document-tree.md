---
id: BASE-120
type: baseline
role: intent
title: "Check the document tree"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
links:
  - {id: SPEC-032, type: supersedes}
---
## Check the document tree

> An author, reviewer or a pre-push hook finds out whether the document tree still has the shape the project declared, and optionally repairs what can be repaired without judgment.

Scope: the tree check and its repair, both modes of the status command. The combined result of several checks is "Report corpus health".

### Behaviour

**Command.** Someone asks the status command to check the tree, optionally with repair.

**Constraint.** The project must declare a tree layout. Every live document is compared with it. A repair moves only orphaned and misplaced documents, and only when exactly one place fits.

**Event.** `TreeChecked` (nothing recorded); `TreeRepaired` (one audit entry per moved document).

### Terms used here

- **Tree layout**, **orphan**, **misplaced document**, **repair**, **finding**: defined in the branch glossary.

### Boundary notes

- The plan-still-open finding names the command that closes the plan; closing it is execution's, and the repair never does it (BR-403).
- What exit code the whole run returns when other checks are also asked for is in "Report corpus health" (BR-438).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Tree layout | none in a new project; this repository declares one | project maintainer | 2026-10-09 |

### Depends on

- Report corpus health: the combined exit code.
- execution: closing a plan whose tasks are all finished.
- corpus (not yet written): the parent of a document.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A repair raises the document's version but writes no history entry for it, so the history has a gap. Should a repair be a recorded version, or not raise the version? | unconfirmed | engineering |
| Q2 | A repair run passes (exit 0) while an open-plan finding remains, unlike the check alone. Intended? | unconfirmed | engineering |
| Q3 | The repair flag without the tree check is silently ignored. Should it be refused? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-400 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-402 | unconfirmed | established | Should a project that never declared a layout get a clear 'not configured' pass instead of exit 4? |
| BR-403 | unconfirmed | established | Should the finding count tasks by plan membership rather than by parent, like the other plan rules do? |
| BR-404 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-406 | unconfirmed | established | Should a repair add a history entry, or leave the version unchanged as the audit-only design describes? |
| BR-407 | unconfirmed | established | Should a repair run fail on every finding it could not repair, as the check alone does? |
| BR-408 | unconfirmed | established | Should the repair flag alone be refused as a usage error? |
| BR-409 | unconfirmed | established | Should a repair be refused like any other write into a foreign corpus? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-401. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
