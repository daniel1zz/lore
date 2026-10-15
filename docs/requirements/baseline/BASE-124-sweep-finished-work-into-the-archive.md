---
id: BASE-124
type: baseline
role: intent
title: "Sweep finished work into the archive"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
---
## Sweep finished work into the archive

> An agent or maintainer lists, or archives in one pass, the handoffs and tasks whose purpose is over.

Scope: the archive command's report and apply modes. Archiving a task on purpose and the cascade when a plan closes are execution's.

### Behaviour

**Command.** Someone asks for the archive sweep report, or for it to be applied.

**Constraint.** Exactly one mode. Candidates are recomputed from the whole corpus each time. Three rules decide a candidate: superseded handoff, expired handoff, leftover task.

**Event.** `ArchiveSwept` (report: nothing recorded); `DocArchived` (apply: one version and one audit entry per document).

### Terms used here

- **Archive candidate**, **superseded handoff**, **expired handoff**, **leftover task**: defined in the branch glossary.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Handoff time limit | 10,080 minutes (7 days) | project maintainer | 2026-10-09 |
| Claim freshness limit | 120 minutes | project maintainer | 2026-10-09 |

### Depends on

- execution: plans, tasks and claims; the plan-close cascade.
- session, "Hand off a session": handoffs.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Applying the sweep exits 0 even when every archive failed. Should a failure be visible in the exit code? | undecided | product |
| Q2 | Leftover tasks are found by their parent, not by plan membership. A member filed elsewhere is missed and a non-member filed under the plan is archived. | unconfirmed | engineering |
| Q3 | Archiving a leftover task applies none of the archival requirements (evidence and the rest). Intended? | undecided | product |
| Q4 | The sweep's archive write skips the guard that refuses writes into another checkout's corpus. Should the sweep be refused like other foreign-corpus writes? | unconfirmed | engineering |
| Q5 | Which criterion, with a test that fails if the rule is false, should establish that the archive command needs exactly one mode (BR-448)? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-448 | unconfirmed | established | Q5. Lost its only citation in the 2026-10-09 citation audit: an independent fidelity judge found the citing criterion's test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). |
| BR-455 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-456 | undecided | established | Q1: should any failed archive make the apply run fail? |
| BR-457 | unconfirmed | established | Q2: should the leftover rule use plan membership like the cascade does? |
| BR-458 | undecided | established | Q3: is the sweep meant to be a road around the task archival requirements? |
| BR-459 | unconfirmed | established | Q4: should the sweep be refused like other foreign-corpus writes? |
