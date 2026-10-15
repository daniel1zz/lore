---
id: BASE-118
type: baseline
role: intent
title: "Check project memory files"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
---
## Check project memory files

> A maintainer or pre-push hook learns which memory files are over their size limits, badly structured, over-emphatic, or point at corpus documents that do not exist.

Scope: the memory-file limits check (which never opens the corpus) and the memory-pointer check (which does), both modes of the status command. Writing memory files and setting their budgets is context's.

### Behaviour

**Command.** Someone asks the status command to check memory files, or their corpus pointers.

**Constraint.** Files are found by name under the project; each is measured against the limits of its role. The project's adoption mode decides whether findings fail the run (BR-427). Asked together with other corpus-reading checks, the limits check runs on its own and the others do not run; only the binary check and the member lists take priority over it (parent note "Checks compose").

**Event.** `MemoryFilesChecked` (nothing recorded).

### Terms used here

- **Memory file**, **adoption mode**, **advisory note**, **finding**: defined in the branch glossary.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether the limits are checked | on unless switched off (BR-426) | project maintainer | 2026-10-10 |
| Root file limit | 300 lines, 30,720 bytes by default; this repository 220 lines, 24,576 bytes | project maintainer | 2026-10-10 |
| Module file limit | 200 lines, 16,384 bytes | project maintainer | 2026-10-09 |
| Rules file limit | 100 lines, 8,192 bytes | project maintainer | 2026-10-09 |
| Advisory warning point (BR-432) | 90% of a limit | project maintainer | 2026-10-10 |
| Eviction-required point (BR-432) | 97% of a limit | project maintainer | 2026-10-10 |
| Emphasis markers per kilobyte | 3 | project maintainer | 2026-10-09 |
| Adoption mode | warn when unset; this repository enforces | project maintainer | 2026-10-09 |

### Depends on

- context: the memory files and their budget settings.
- Report corpus health: the combined exit code for the pointer check.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A new project is in warn mode, so this check never fails there until someone opts in (BR-427, which stays established: the code does this today, and the answer may change the rule). Intended as the long-term default? | undecided | product |
| Q2 | If the project settings cannot be read, the limits check falls back to the default limits and keeps its exit code (BR-433). Should a project whose own stricter limits cannot be read fail rather than pass on defaults? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-430 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if line length or distance from the recommended count ever changes the exit code. |
| BR-431 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-432 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-433 | unconfirmed | undecided | Q2: should a project whose own stricter limits cannot be read fail rather than pass on defaults? |
