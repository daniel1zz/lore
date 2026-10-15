---
id: BASE-001
type: baseline
role: intent
title: "Resolve a defect report"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-002
links:
  - {id: SPEC-099, type: supersedes}
---
## Resolve a defect report

> A maintainer records why a defect report is finished (or who now owns it), and the GitHub issue is labelled to match.

### Behaviour

**Command.** A maintainer resolves one report as rejected, won't fix, superseded, duplicate or adopted, with a reason and, for the last three, the document it points to.

**Constraint.** Fixed and closed can never be recorded. The reason is required. Superseded, duplicate and adopted need an existing document that is not the report itself, and adopted needs a plan or task. Only a filed defect report can be resolved. The report's status does not change. Separately from resolving by hand, archiving the specification, plan or task that holds a resolving link closes each linked report's GitHub issue as completed once the report reads fixed, with a comment naming that document; a failure is reported, recorded and repaired by a sync, never undoing the archive; an archived document whose text claims to close a report number it has no resolving link to gets a warning (BR-1082). Completing a report's own task with the completion command also closes its issue as completed, with a comment naming the task; a report task archived any other way is only labelled, not claimed as fixed (BR-1084).

**Event.** `DefectResolved` (one version row, one audit entry, and the resolution label written on GitHub).

### Terms used here

- **Explicit resolution**, **adopted (resolution)**, **resolution label**, **resolving link**: defined in the branch glossary.

### Boundary notes

- How the recorded state combines with links and archiving is the list leaf's precedence rule (BR-510).
- The label written here is what the label check compares (BR-516).
- Adoptions whose owner later ends are flagged by hygiene, not here.

### Depends on

- List defect reports: the computed resolution printed and projected.
- File a defect report: GitHub failure kinds and the configured repository.
- corpus (not yet written): reading and writing the report's task.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The criterion AC-DC-14 filters to a test name that no longer exists, so it passes without running anything; its statement also describes the removed report cap. Retire it? | unconfirmed | engineering |
| Q2 | Resolving never closes the GitHub issue. Should a finished resolution close it? Answered for fixed: archiving the resolving work closes it (BR-1082, landed 2026-10-12); still open for the states resolved by hand. | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-530 | unconfirmed | undecided | Should an archived or deprecated owner be refused at the time of adoption? |
| BR-535 | unconfirmed | undecided | Should a label failure after a recorded resolution have its own exit code, as the command's own description promises? |
| BR-536 | unconfirmed | undecided | Should resolving refuse when the report changed since it was read? |
| BR-537 | unconfirmed | undecided | Should a finished resolution also close the GitHub issue? For fixed, archiving the resolving work does (BR-1082); still open for the states resolved by hand. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-528, BR-531, BR-534. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?


**BR-532 held at unconfirmed after the post-remediation fidelity sample (2026-10-09):** its only citation was judged unfaithful (seed 20261010 sample). Open question: which criterion, with a test that fails if the rule is false, should establish it?
