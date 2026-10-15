---
id: BASE-103
type: baseline
role: intent
title: "Delete a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-027, type: supersedes}
---
## Delete a document

> An author removes a document from every list, search and tree.

Scope: soft deletion. A deleted document is hidden from lists, search, the tree and other documents' child lists (BR-740), but the stored document is kept, so "hidden" does not mean unreachable: what it still allows is held in the leaves "Read a document" (reading it by direct reference), "Revise a document" (editing it) and "Invalidate a document" (invalidating it).

### Behaviour

**Command.** An author deletes a document and confirms it.

**Constraint.** Confirmation is required (BR-739). Deleting a document that is already deleted fails with a storage error (BR-742, suspected defect).

**Event.** `DocDeleted`: the document is hidden from every view, a version entry numbered 0 and an audit entry naming the acting identity are written, and a recovery date 30 days ahead is reported (BR-740).

### Boundary notes

- The foreign-corpus refusal applies here (BR-802).
- Deletion does not touch other documents (BR-743).
- No action brings a deleted document back (BR-741, reported in issue #100); a second deletion's storage error is reported in issue #85.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Recovery date reported | 30 days after deletion | product | 2026-10-09 |

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Deletion promises recovery for 30 days, and no action recovers (BR-741). Should a recovery action exist, or the promise go? | unconfirmed | product |
| Q2 | Should deleting a document that others depend on (children, incoming links, a plan's tasks) be refused or cascade (BR-743)? | undecided | product |
| Q3 | A second deletion of the same document fails with a storage error (BR-742). Should it succeed as a no-op or be refused as not found? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-739 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-740 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-741 | unconfirmed | established | Q1: should a recovery action exist, or the 30-day promise be removed? |
| BR-742 | unconfirmed | established | Q3: should a second deletion succeed as a no-op or be refused as not found? |
| BR-743 | unconfirmed | established | Q2: should deleting a document that others depend on be refused or cascade? The rule describes what the code does until product decides. |
