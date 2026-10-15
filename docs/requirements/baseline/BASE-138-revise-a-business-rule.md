---
id: BASE-138
type: baseline
role: intent
title: "Revise a business rule"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Revise a business rule

> An author changes a rule's wording, confidence, enforcement or examples, keeping its id.

### Behaviour

**Command.** An author names a rule id and the fields to change.

**Constraint.** The id is well-formed and held by a live leaf; at least one change is named (BR-637); the revised rule is well-formed (BR-638). Lifecycle and place do not limit a revision (BR-639).

**Event.** `BusinessRuleRevised` (one version of the leaf, one audit entry listing the fields changed).

### Terms used here

- **Business rule**, **rule id**, **rule lifecycle**: defined in the branch glossary.

### Boundary notes

- The same command retires and moves a rule; those are the leaves "Retire a business rule" and "Move a business rule".
- A revision does not touch the criteria that cite the rule (specification); a criterion may now cite wording it was not written against.

### Current values

None.

### Depends on

- Write a business rule: shape, concurrency, scope, demotion (BR-623, BR-631, BR-630, BR-628).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A retired rule's statement can still be rewritten. Should a retired rule be frozen? | undecided | product (owner) |
| Q2 | Rewording a cited rule changes nothing on the citing criteria and leaves no mark on them. Should citing criteria be flagged for re-check? | undecided | product |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-636 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-637 | unconfirmed | established | Should the not-found message for a rule point at finding rules instead of listing documents? |
| BR-638 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-639 | undecided | undecided | Should revising a retired rule be refused, so that what was retired stays as it was? |
| BR-640 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
