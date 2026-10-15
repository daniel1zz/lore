---
id: BASE-126
type: baseline
role: intent
title: "Verify the audit trail"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
links:
  - {id: SPEC-094, type: supersedes}
---
## Verify the audit trail

> A maintainer or pre-push hook confirms that every recorded change has its audit entry, that no entry was edited or removed, and that the chain still matches the head pinned earlier.

Scope: the verification mode and the anchor mode of the audit command.

### Behaviour

**Command.** Someone verifies the audit trail, or pins its current head.

**Constraint.** Completeness is checked since a cut-off date; the hash chain over the whole trail; the pinned head when one exists.

**Event.** `AuditVerified` (nothing recorded); `AuditAnchored` (a project file written; no version and no audit entry).

### Terms used here

- **Completeness check**, **hash chain**, **chain anchor**: defined in the branch glossary.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Completeness cut-off date | 2026-07-06 | project maintainer | 2026-10-09 |

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Anchoring pins the head without checking the chain first, so a broken chain can be pinned. Intended? | undecided | engineering |
| Q2 | A cut-off given for one run is not checked as a time, so a value that is not a time silently changes which versions are checked (suspected defect, parent note "Times given as text are not checked"). Should it be refused? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-476 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-478 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-480 | undecided | established | Q1: should pinning refuse a chain that does not verify? |
| BR-481 | unconfirmed | established | Q2, a suspected defect rather than a question about intent: should an unreadable cut-off be refused? The rule states what the code does today and waits for a check-decided criterion. |
