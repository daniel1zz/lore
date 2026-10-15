---
id: BASE-107
type: baseline
role: intent
title: "Read a document's history"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-006, type: supersedes}
---
## Read a document's history

> Anyone sees the versions of a document, and what changed between two of them.

### Behaviour

**Command.** A reader asks for a document's history, or for the difference between two versions.

**Constraint.** The versions named must exist (BR-769).

**Event.** None: reading history writes nothing.

### Boundary notes

- Every version shows 'system' as author on most routes (BR-703); who acted is in the audit trail, which is a separate view.
- Phase changes made before phase writes started logging versions are not in the history (execution).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A missing version is reported as 'document not found' with the version as a suggestion. Should it be its own message? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-767 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-768 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-769 | unconfirmed | established | Should a missing version get its own message? |
