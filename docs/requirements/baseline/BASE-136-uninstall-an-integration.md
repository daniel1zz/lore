---
id: BASE-136
type: baseline
role: intent
title: "Uninstall an integration"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-046
links:
  - {id: SPEC-096, type: supersedes}
---
## Uninstall an integration

> A person or agent reverses what an install (agent settings directory) or a project scaffold (the project) recorded in its ledger.

### Behaviour

**Command.** Uninstall the integration, or uninstall the project scaffold.

**Constraint.** Confirmation is required (BR-811). Only what the ledger lists is touched (BR-840). Without a readable, valid ledger nothing is done (BR-841). Removal never reaches through a link (BR-843).

**Event.** `IntegrationUninstalled`: backed-up files restored, created files removed, backups removed, ledger deleted last (BR-840); for the global uninstall also emptied directories pruned (BR-976) and the tool server de-registered (BR-844). No corpus document or audit entry.

The result is not always the directory exactly as it was before: the global uninstall also removes a directory that existed empty before the install (BR-976, Q2), and the project uninstall leaves behind what its ledger never listed (BR-845, BR-977, and git's hooks setting per BR-837).

### Terms used here

- **Install ledger**, **backup run**, **managed file**: defined in the branch glossary.

### Boundary notes

- The project uninstall leaves the corpus itself in place; this is intended (BR-977).
- That the project uninstall does not restore git's hooks setting is a suspected defect owned by the scaffold leaf (BR-837); this leaf does not track it again.
- An unreadable project ledger is refused here (BR-841) but treated as absent by the scaffold (BR-838).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| (none) | | | 2026-10-09 |

### Depends on

- Install the agent integration and Scaffold a project workflow: the ledgers this leaf reads.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Rules files written by the project setup's context refresh are not in the project ledger and stay after uninstall (BR-845). Should they be tracked? | unconfirmed | engineering |
| Q2 | The global uninstall removes a directory that existed empty before the install and was filled by it (BR-976). Accepted simplification? | undecided | product |
| Q3 | Which criterion, with a test that fails if the rule is false, should establish BR-977? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-841 | unconfirmed | established | No question about intent: the missing criterion: the refusal is tested at the service level, not the exit code. |
| BR-842 | unconfirmed | established | No question about intent: the missing criterion: the stop and kept ledger are service-tested; exit 1 is not. |
| BR-844 | unconfirmed | established | No question about intent: the missing criterion: no criterion drives a failed de-registration. |
| BR-845 | unconfirmed | established | Q1. |
| BR-976 | undecided | established | Q2: the owner has not decided whether pruning a directory that existed before the install is accepted. |
| BR-977 | unconfirmed | established | Q3. |

**Reworded 2026-10-10:** BR-840 no longer includes directory pruning, which moved to BR-976 because Q2 is undecided; BR-840 stays established for the restore, remove and ledger-last behaviour its criterion checks. BR-841 now states the corrupt-ledger refusal for both targets. BR-845 now covers only the rules files.
