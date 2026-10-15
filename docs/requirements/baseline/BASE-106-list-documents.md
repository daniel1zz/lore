---
id: BASE-106
type: baseline
role: intent
title: "List documents"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-015, type: supersedes}
  - {id: SPEC-023, type: supersedes}
  - {id: SPEC-036, type: supersedes}
---
## List documents

> Anyone sees the documents that match some filters.

### Behaviour

**Command.** A reader lists documents with optional filters.

**Constraint.** Deleted documents never appear; invalidated ones only on request (BR-745).

**Event.** None: listing writes nothing.

### Boundary notes

- Listing the documents a skill governs is the same command; the governs link is context's.
- Readiness of a plan's tasks is execution's.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The author filter finds nothing for documents written on the command line (BR-747). Should it read the audit trail, or should the recorded author change? | unconfirmed | product |
| Q2 | Should an unknown type or status filter be refused (BR-748)? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-744 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-747 | unconfirmed | established | Should the author filter read the acting identity from the audit trail? |
| BR-748 | unconfirmed | established | Should an unknown filter value end with a usage error, as an unknown knowledge kind does? |
