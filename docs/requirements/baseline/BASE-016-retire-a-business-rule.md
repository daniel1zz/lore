---
id: BASE-016
type: baseline
role: intent
title: "Retire a business rule"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-081
---
## Retire a business rule

> An author deprecates a rule that is no longer preferred, or retires one that is no longer true, with a note saying why.

### Behaviour

**Command.** An author names a rule id and the new lifecycle (deprecated or retired), with a retirement note when retiring.

**Constraint.** The lifecycle only moves forward (BR-641); retiring needs a note, and a note needs retiring (BR-642).

**Event.** `BusinessRuleDeprecated`, `BusinessRuleRetired` (one version of the leaf).

### Terms used here

- **Rule lifecycle**: defined in the branch glossary.

### Boundary notes

- The rule stays on its leaf (BR-643); its id is never reissued (BR-625).
- Criteria that cite a retired rule are not changed (BR-644); the citation gate (specification) is what will refuse new citations of inactive rules.

### Current values

None.

### Depends on

- Write a business rule: BR-625, BR-631, BR-630.
- specification, "Cite a baseline rule": citations of the rule.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should retiring a rule that live criteria still cite be refused, or should it at least report them? | undecided | product (owner) |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-643 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-644 | undecided | undecided | Should retiring a still-cited rule be refused, or report the citing criteria? |
