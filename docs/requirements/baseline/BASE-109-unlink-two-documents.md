---
id: BASE-109
type: baseline
role: intent
title: "Unlink two documents"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
---
## Unlink two documents

> An author removes the relations from one document to another.

### Behaviour

**Command.** An author unlinks document A from document B.

**Constraint.** None: every link from A to B, of any type, is removed. Links from B to A are untouched.

**Event.** `DocUnlinked` (one audit entry when anything was removed).

### Boundary notes

- The foreign-corpus refusal applies here (BR-802).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should removing a parent link also clear the recorded parent (BR-765)? | unconfirmed | engineering |
| Q2 | Should unlinking only one link type be possible? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-764 | unconfirmed | established | Should the output say when nothing was removed? |
| BR-765 | unconfirmed | established | Should removing a parent link clear the recorded parent? |
