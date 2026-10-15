---
id: BASE-137
type: baseline
role: intent
title: "Move a business rule"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Move a business rule

> An author relocates a rule to the leaf it belongs to, keeping its id so every citation stays valid.

### Behaviour

**Command.** An author names a rule id and a destination leaf (optionally revising the rule in the same request).

**Constraint.** The destination is a different leaf (BR-646); from a worktree, the scope covers both leaves' branches (BR-630).

**Event.** `BusinessRuleMoved` (a version and an audit entry on each of the two leaves).

### Terms used here

- **Rule id**, **leaf**: defined in the branch glossary.

### Boundary notes

- Moving does not change citations: they name the id, which does not change (BR-645).

### Current values

None.

### Depends on

- Write a business rule: BR-631, BR-630, BR-628.

### Open questions

None.

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-648 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-649 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |



**BR-646 held at unconfirmed (2026-10-09):** its falsifying criterion AC-BLS1-2 already cites the maximum of 10 rules, so the citation was refused; a dedicated criterion is needed before it can be established. A criterion citing 10 rules is itself a probable catch-all (AC-BLS2-14).


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-645, BR-647. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
