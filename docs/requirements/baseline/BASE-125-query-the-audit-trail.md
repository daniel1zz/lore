---
id: BASE-125
type: baseline
role: intent
title: "Query the audit trail"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
links:
  - {id: SPEC-033, type: supersedes}
  - {id: SPEC-094, type: supersedes}
---
## Query the audit trail

> A reviewer or agent reads who did what, when and why, for one document or across the corpus.

Scope: the query mode of the audit command. Verification and anchoring are "Verify the audit trail".

### Behaviour

**Command.** Someone queries the audit trail, optionally for one document and filtered by actor, action, time and count.

**Constraint.** Filters combine; the query only reads.

**Event.** `AuditQueried` (nothing recorded).

### Terms used here

- **Audit trail**: defined in the branch glossary.

### Depends on

- Every write in the product: the entries themselves.
- corpus (not yet written): resolving the document named.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A time filter in a form the product cannot read gives an empty answer with exit 0. Should it be refused? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-473 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-474 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-475 | unconfirmed | established | Should an unreadable time be refused with a usage error? |
