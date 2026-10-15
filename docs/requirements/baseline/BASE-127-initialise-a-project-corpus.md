---
id: BASE-127
type: baseline
role: intent
title: "Initialise a project corpus"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-046
---
## Initialise a project corpus

> A person or agent creates an empty project corpus in the current directory so that every other command has a place to keep documents.

### Behaviour

**Command.** Initialise, optionally naming the project and the default author.

**Constraint.** Refused when the current directory already holds a corpus. Only the current directory is checked, not its parents.

**Event.** `ProjectCorpusInitialised`: a hidden corpus directory with an ignore list, a settings file and an empty database. No document and no audit entry is written.

### Terms used here

- **Project corpus**: defined in the branch glossary.

### Boundary notes

- Scaffolding a project creates the corpus the same way when none exists, and additionally seeds recommended verification settings (BR-829); initialising does not.
- Every other command finds the nearest corpus above the current directory; that lookup is corpus behaviour.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Default project name | the current directory's name | the caller, per run | 2026-10-09 |
| Default author | owner | the caller, per run | 2026-10-09 |

### Depends on

- corpus (not yet written): opening the corpus and finding it from below.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should initialising inside a directory whose parent already holds a corpus be refused or warned about? Today it silently creates a nested corpus that hides the parent's for commands run below it. | undecided | product |
| Q2 | No structured acceptance criterion covers initialising; the spawned end-to-end test exists but is cited only from prose. | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-807 | unconfirmed | established | No question about intent: the missing criterion: the end-to-end initialise test is cited only from prose (AC-E2E-001.01 of the CLI spec is not a structured criterion). |
| BR-808 | unconfirmed | established | No question about intent: the missing criterion: the spawned test asserts only a non-zero exit and is cited from prose. |
| BR-809 | undecided | established | Is a silently nested corpus intended, or should initialising refuse or warn when a parent directory already holds one? |
| BR-810 | unconfirmed | established | Should a failed initialise remove what it created, so that the retry can succeed? |
