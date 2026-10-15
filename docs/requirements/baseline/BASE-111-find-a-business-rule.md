---
id: BASE-111
type: baseline
role: intent
title: "Find a business rule"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Find a business rule

> An author or agent shows one rule with everything that cites it, or finds the rules relevant to a spec, a file or a phrase.

### Behaviour

**Command.** Someone shows a rule by id, or finds rules by exactly one of a spec, a file or a phrase (BR-679).

**Constraint.** Read-only; a shown id must be held by a live leaf (BR-676).

**Event.** None; read-only.

### Terms used here

- **Business rule**, **citing criterion**, **rule lifecycle**: defined in the branch glossary. "State" in the shown rule is its lifecycle, not its verification state.

### Boundary notes

- Finding by file goes through the code anchors of specs (specification): a rule is found for a file only if a spec anchored to that file cites it.

### Current values

None.

### Depends on

- specification: citations and code anchors.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Finding by a spec that does not exist answers 'no matching rules' instead of not found. Intended? | undecided | product |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-678 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-679 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-680 | undecided | undecided | Should an unknown spec be refused as not found? |
