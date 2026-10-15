---
id: BASE-057
type: baseline
role: intent
title: "Define a glossary term"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Define a glossary term

> An author defines a word on a root or a branch, with its meaning in this product, or removes it.

### Behaviour

**Command.** An author names a root or branch, a term, its meaning and an optional note; or names a term to remove.

**Constraint.** Terms live on roots and branches only (BR-619); a term may be defined once per node, compared exactly (BR-620); term and meaning are not empty (BR-621); only a defined term can be removed (BR-622).

**Event.** `GlossaryTermDefined`, `GlossaryTermRemoved` (each a new version of the node).

### Terms used here

- **Glossary term**, **root**, **branch**: defined in the branch glossary.

### Boundary notes

- Glossaries are read by people and by the tree listing; nothing in the product checks that a rule uses a defined term.

### Current values

None.

### Depends on

- Add a baseline node: the node the term is defined on.
- Write a business rule: shared rules on concurrent change, worktree scope, demotion and stored details (BR-631, BR-630, BR-628, BR-632).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | 'Rule' and 'rule' are two terms on one node. Should term comparison ignore case? | undecided | product |
| Q2 | There is no action to change a term's meaning except removing and re-adding it. Intended? | undecided | product |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-620 | unconfirmed | undecided | Should terms be compared without regard to capitals? |
| BR-621 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-622 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-619. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
