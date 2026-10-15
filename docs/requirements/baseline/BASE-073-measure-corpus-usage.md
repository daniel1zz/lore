---
id: BASE-073
type: baseline
role: intent
title: "Measure corpus usage"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
links:
  - {id: SPEC-012, type: supersedes}
---
## Measure corpus usage

> A maintainer finds out, from data rather than recollection, whether documents are read, whether searches find anything, and how often gates refuse.

Scope: the usage report and its member lists, how long usage records are kept, and the telemetry file: the dashboard's page-view lines (BR-993) and the program's per-call lines for document create, read, list, search and link (BR-1013). Recording the usage trace is a side effect of reads, searches and gate refusals in other branches; this leaf owns what is kept and for how long. Telemetry is held here because it is the other measure of how the corpus is used, even though it goes to its own file and the usage report does not count it.

### Behaviour

**Command.** Someone asks for the usage report over a time window (all time by default), optionally with raw search texts or the members behind a count. The report gives counts by kind of record, gate refusals by checkpoint, the number of searches that found nothing, the number of live documents never read in the window (BR-482), and, per checkpoint, an estimate of how many gate refusals were followed by a success of the same actor (BR-488). Only the never-read and zero-hit counts can be listed by member; any other count name is refused with exit code 4 (BR-485). Raw search texts appear only on request (BR-486).

**Constraint.** The report itself records nothing (BR-483). The time window is not checked: an unreadable start gives an empty report with exit 0 (BR-487, suspected defect). For plan closing the retry estimate counts an archive action that no write records, so only approvals can count there (BR-488, suspected defect).

**Event.** `UsageReported` (nothing recorded). Two other actions change stored usage data: when the program starts, usage records older than the keep period are removed (BR-484); and, with telemetry on, the telemetry file grows: each distinct page a dashboard user opens adds one line (BR-993), and each document create, read, list, search and link call of the program adds one line naming the action, whether it succeeded, its error code on failure and how long it took (BR-1013). A failed telemetry write never changes a command's outcome or exit code, and telemetry lines add no version or audit entry.

### Terms used here

- **Usage trace**, **never-read document**, **zero-hit search**: defined in the branch glossary.
- **Telemetry file**: the project's file of usage events written by the program and the dashboard (`.lore/telemetry.jsonl` unless set otherwise); separate from the usage trace and not read by the usage report.

### Boundary notes

- The dashboard pages themselves, and when the dashboard runs, are distribution's ("Launch the dashboard"); only the page-view record they leave is ruled here.
- Usage-trace recording and telemetry recording are switched separately: turning one off does not turn off the other. The one telemetry switch covers both the dashboard page views and the program's per-call lines.
- Program telemetry read in code on 2026-10-10: `packages/lore/src/service/corpus-service.ts:889-904` (`recordTelemetryEvent`, called from create, get, list, search and link), `packages/core/src/telemetry.ts:246-251` (on by default, default path), `packages/core/src/telemetry-node.ts:70-75` (a failed append is swallowed).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Usage trace recording | on | project maintainer | 2026-10-09 |
| Days a usage record is kept | 90 | project maintainer | 2026-10-09 |
| Telemetry recording (dashboard page views and program per-call lines) | on | project maintainer | 2026-10-10 |
| Telemetry file | `.lore/telemetry.jsonl` | project maintainer | 2026-10-10 |

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A time window the product cannot read gives an empty report with exit 0. Should it be refused? | unconfirmed | engineering |
| Q2 | The retry measure for plan closing counts an action no write records. Should it be corrected or dropped? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-993 and BR-1013 read on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`); `observed` is used for a rule measured in code that no criterion cites yet. Every rule of this leaf held below established is listed here; BR-482, BR-483 and BR-484 are established.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-485 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-486 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-487 | unconfirmed | established | Q1 |
| BR-488 | unconfirmed | established | Q2 |
| BR-993 | unconfirmed | established | No question about intent: the page-view record is tested under AC-075-8, but no criterion cites this rule. |
| BR-1013 | observed | established | No question about intent; read from the code (see Boundary notes). Waiting for a check-decided criterion that runs a document call with telemetry on and off and fails if the line is missing or present. |
