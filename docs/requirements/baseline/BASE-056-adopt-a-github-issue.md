---
id: BASE-056
type: baseline
role: intent
title: "Adopt a GitHub issue"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-002
links:
  - {id: SPEC-099, type: supersedes}
---
## Adopt a GitHub issue

> A maintainer turns one GitHub issue that was filed through lore, but has no task in this corpus, into a task that can be claimed.

### Behaviour

**Command.** A maintainer adopts one issue by the number the list printed.

**Constraint.** A GitHub destination must be configured. The issue must be in the repository's live list and must carry the filing field block. The corpus needs a root requirements document. Adopting the same issue again creates nothing.

**Event.** `DefectAdopted` (an ad-hoc task with one version row and a creation audit entry).

### Terms used here

- **Adopt (an issue)**, **ingested**, **filing field block**: defined in the branch glossary. Not the same as the adopted resolution.

### Boundary notes

- Filing already creates the task; adopting is for issues filed from another corpus, or whose task could not be written (BR-496).
- The task is the same kind filing creates (BR-495); claiming it belongs to execution.

### Depends on

- List defect reports: the live GitHub list the number must be in.
- File a defect report: the filing field block, GitHub failure kinds.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A number written as '0x10' or '1e3' is read as 16 or 1000. Should only plain digits be accepted? | undecided | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-520 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-521 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-524 | unconfirmed | established | With several requirements documents, the first one listed is used. Which one is meant? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-522, BR-523, BR-526. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
