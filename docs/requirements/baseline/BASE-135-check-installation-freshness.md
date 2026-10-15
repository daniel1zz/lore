---
id: BASE-135
type: baseline
role: intent
title: "Check installation freshness"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-046
links:
  - {id: SPEC-096, type: supersedes}
---
## Check installation freshness

> A person, agent or session hook learns whether the installed integration matches what the running program ships, without changing it.

### Behaviour

**Command.** Check an agent settings directory.

**Constraint.** Read-only except a small check cache. Combined with any mutating mode it is refused. The project scaffold has no freshness check yet.

**Event.** `InstallationChecked`: a report and the check cache. No corpus document or audit entry.

### Terms used here

- **Freshness check**, **install ledger**, **diverged file**: defined in the branch glossary.

### Boundary notes

- The defect channel probe belongs to issue-loop; this leaf owns only how its result enters the exit code (BR-850).
- The session-start reminder that reads the check cache is session behaviour.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Exit code when stale | 3 | product | 2026-10-09 |
| Exit code when the defect channel tool is missing or not logged in | 8 | product | 2026-10-09 |

### Depends on

- Install the agent integration: the ledger read here.
- issue-loop (not yet written): the defect channel probe.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A machine without the defect channel's command-line tool gets exit 8 from the check even when every file is in sync. Should the channel probe affect the exit code at all? | undecided | product |
| Q2 | Checking the project scaffold is refused as not yet supported. Planned? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-848 | unconfirmed | established | Should only a genuinely absent ledger count as never installed, with any other read failure reported as an error? |
| BR-850 | unconfirmed | established | Should the probe read the project's own configured tracker, and should a missing channel tool fail a check whose files are in sync? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-847, BR-849. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
