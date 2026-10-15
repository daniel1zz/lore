---
id: BASE-121
type: baseline
role: intent
title: "Detect code-anchor drift"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
links:
  - {id: SPEC-102, type: supersedes}
---
## Detect code-anchor drift

> An author, reviewer or pre-push hook learns which code anchors no longer match the code, with the command that repairs each one.

Scope: the drift check of the status command. Declaring and removing anchors is the specification leaf "Declare a code anchor".

### Behaviour

**Command.** Someone asks the status command to check drift.

**Constraint.** Every anchor declared on a spec or knowledge document that is not deleted is looked up in the working tree, whatever the document's status, archived and deprecated included (BR-410); each distinct location is looked at once (BR-412). Any finding, a probe error included, fails the run with exit code 3; a clean run, or one with no anchors at all, exits 0 (BR-411, BR-412, BR-413). The project may switch the check off (BR-414).

**Event.** `DriftChecked` (nothing recorded).

### Terms used here

- **Anchor drift**, **finding**: defined in the branch glossary. **Code anchor**: specification glossary.

### Boundary notes

- Anchors are written by the specification branch, which refuses malformed ones at write time; this check only reads them (BR-416).
- The plain report counts documents with anchors without looking at files (BR-441).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether the drift check runs | on (new project and this repository) | project maintainer | 2026-10-09 |

### Depends on

- specification, "Declare a code anchor": the anchors.
- Report corpus health: the combined exit code.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Anchors on archived and deprecated documents are still checked and fail the run. Should finished documents be exempt? | undecided | product |
| Q2 | A stored anchor the product cannot read is skipped without a finding. Should it be reported? | unconfirmed | engineering |
| Q3 | Exported names are found by a text scan, which reports some valid export forms as missing. Is a text scan the intended contract, with its known false findings? | undecided | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-410 | unconfirmed | undecided | Q1: should anchors on archived or deprecated documents be checked at all? |
| BR-412 | unconfirmed | established | None about intent. Waiting for a check-decided criterion that injects a failing look-up and asserts the other locations are still checked and the run exits 3. |
| BR-416 | unconfirmed | established | Q2: should an unreadable stored anchor be a drift finding of its own? |
| BR-417 | unconfirmed | undecided | Q3: is a text scan the intended contract, with its known false findings? |
