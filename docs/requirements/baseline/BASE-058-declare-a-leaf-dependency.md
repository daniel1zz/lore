---
id: BASE-058
type: baseline
role: intent
title: "Declare a leaf dependency"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Declare a leaf dependency

> An author records which rules a leaf relies on, so that a change to one of them can be traced to the leaf.

### Behaviour

**Command.** An author names a leaf and rule ids to add to or remove from its dependencies.

**Constraint.** At least one id; each well-formed; each added id exists (BR-650); each removed id is present (BR-651). What the id names is not checked further (BR-652).

**Event.** `LeafDependencyDeclared` (one version of the leaf).

### Terms used here

- **Dependency**, **rule id**: defined in the branch glossary.

### Boundary notes

- Dependencies are read by "Assess a rule's impact".

### Current values

None.

### Depends on

- Write a business rule: BR-631, BR-630, BR-628, BR-632.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should a leaf be allowed to depend on its own rule, a retired rule, or a rule of a deleted leaf? | undecided | product |
| Q2 | Re-adding a dependency already present writes a version though nothing changes. | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-651 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-652 | undecided | undecided | Should depending on an own rule, an inactive rule or a rule of a deleted leaf be refused? |
| BR-653 | unconfirmed | established | Should a change that alters nothing be refused or leave no version? |



**BR-650 held at unconfirmed (2026-10-09):** its falsifying criterion AC-BLS1-2 already cites the maximum of 10 rules, so the citation was refused; a dedicated criterion is needed before it can be established. A criterion citing 10 rules is itself a probable catch-all (AC-BLS2-14).
