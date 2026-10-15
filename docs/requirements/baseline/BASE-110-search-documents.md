---
id: BASE-110
type: baseline
role: intent
title: "Search documents"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-002, type: supersedes}
  - {id: SPEC-015, type: supersedes}
  - {id: SPEC-031, type: supersedes}
---
## Search documents

> Anyone finds documents by the words they contain.

### Behaviour

**Command.** A reader searches with some words and optional filters.

**Constraint.** Deleted documents never appear; invalidated ones only on request (BR-750).

**Event.** None in the corpus; a search may be noted in the usage trace.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The total shown is the count after the limit (BR-752). Should the number of matches be reported? | undecided | product |
| Q2 | An unknown type filter returns nothing with exit code 0, as in the list. Should it be refused? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-749 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-752 | undecided | undecided | Should search report how many documents matched in total? |
