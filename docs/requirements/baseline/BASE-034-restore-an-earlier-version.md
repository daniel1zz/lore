---
id: BASE-034
type: baseline
role: intent
title: "Restore an earlier version"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-11
tags: []
parent: BASE-066
links:
  - {id: SPEC-006, type: supersedes}
  - {id: SPEC-027, type: supersedes}
---
## Restore an earlier version

> An author brings back the content of an earlier version of a document.

### Behaviour

**Command.** An author restores a document to a version number.

**Constraint.** The version must exist: a number below 1 or a version that does not exist is refused and nothing is written (BR-775).

**Event.** `DocRestored`: the title, body and details of the earlier version come back as a new version, with a version entry naming the version restored from and an audit entry (BR-770). History is never rewritten, and the document keeps its current name (BR-771). The restored document is always draft (BR-772). The version and audit entries name the document's recorded author, not whoever restored it (BR-773). A spec's older criteria come back with it (BR-774).

### Boundary notes

- Restoring an earlier version of a locked record is refused before anything is written ("Keep a record unchanged", BR-1048); there is no correction exit for a restore. BR-772 describes restore only for documents that are living or not yet locked.
- Restoring is three separate writes (document, then version entry, then audit entry); a failure after the first leaves the document changed without its version or audit entry (BR-968, suspected defect, issue #113).
- Restoring does not bring a deleted document back (BR-741).
- Restoring is not refused from a linked worktree (BR-806).
- The suspected defects in BR-772, BR-773 and BR-774 are reported in issue #100.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should restoring an archived or deprecated document be refused, as every status change out of those is (BR-772)? | unconfirmed | product |
| Q2 | Should restoring a spec's older criteria go through the criterion actions (BR-774)? | unconfirmed | product |
| Q3 | Should restore record the acting identity like every other write (BR-773)? | unconfirmed | product |
| Q4 | Should a restore land all three writes or none of them (BR-968)? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-10, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-770 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-772 | unconfirmed | established | Q1: should restoring an archived or deprecated document be refused? |
| BR-773 | unconfirmed | established | Q3: should restore record the acting identity like every other write? |
| BR-774 | unconfirmed | established | Q2: should criteria changed by a restore go through the criterion actions? |
| BR-775 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-968 | unconfirmed | established | Q4: should a restore land all three writes or none of them? |
