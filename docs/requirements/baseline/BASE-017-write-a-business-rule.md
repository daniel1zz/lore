---
id: BASE-017
type: baseline
role: intent
title: "Write a business rule"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-081
---
## Write a business rule

> An author adds a new numbered rule to a node that holds rules: a business leaf, or in the architecture tree a standard or a debt registry.

This leaf also holds the rules that apply to every dedicated write to a baseline node (concurrent change, writing from a worktree, demotion of an approved node, refusal of general edits, re-checking stored details). The other writer leaves map their sites to them.

### Behaviour

**Command.** An author names a node, a statement, a confidence, an enforcement and one to three examples. For an architecture standard, the author may also give the four standard parts: what the code does today, the rule it should follow, its current exceptions and how they get closed.

**Constraint.** The rule is well-formed, and the four standard parts are given only on a standard, all four or none (BR-623); the target is a live node that holds rules: a business leaf (BR-624) or an architecture standard or debt registry (BR-1002), and not deleted (BR-633); a standard's current exceptions each name a live debt entry (BR-1002); from a worktree, the session's claim covers the node's branch (BR-630). These checks run before anything is written, so a refusal among them leaves the node as it was. Implementation detail in the statement is not refused (BR-635).

**Event.** `BusinessRuleAdded`: a new permanent id in the node's family: BR on a business leaf (BR-625), AS on a standard, AD on a debt registry (BR-1002), and one version of the node with one audit entry for the add (BR-626). On an approved node the move back to draft is written first as one more version and audit entry, so the node gains two versions in all (BR-627). A refusal after that move (invalid stored details, BR-632, or collisions after three re-applications, BR-631) leaves the node in draft without the rule (BR-627).

### Terms used here

- **Business rule**, **rule id**, **confidence**, **enforcement**, **corpus scope**: defined in the branch glossary.
- **Architecture standard** (AS ids) and **debt entry** (AD ids): rules held by the architecture tree's standard and debt-registry nodes. A debt entry is never cited by a criterion; it is named only in a standard's current exceptions.

### Boundary notes

- Citing the rule from a criterion is the specification branch's leaf "Cite a baseline rule". Standards (AS) can be cited; debt entries (AD) are refused there.
- What a particular standard or debt entry says belongs to that node of the architecture tree, and creating architecture nodes belongs to "Add a baseline node" (BR-979). The product baseline branch places adding rules to standards and debt registries in this leaf: the same add action writes them, with the same id registry and the same write rules (BR-626 to BR-632).
- Split with **hygiene**: this leaf owns how implementation detail in a statement is recognised (BR-634) and that adding such a rule is not refused (BR-635). Hygiene owns only the corpus status report's count of live rules that contain it, which is what the parent's Outside list gives hygiene.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Re-applications after a concurrent change before refusing | 3 | product code (not a project setting) | 2026-10-09 |

### Depends on

- Add a baseline node: the leaf.
- Retire a business rule, Move a business rule: what happens to the id later.
- specification, "Cite a baseline rule": who cites the rule.
- execution (claims): the claim whose corpus scope admits a worktree write.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A statement full of file paths, flags and settings keys is accepted with no warning; only the status report counts it later (BR-635), although the tree's conventions forbid such detail. Should adding it warn, or be refused? | unconfirmed | product |
| Q2 | The confidence is chosen freely by the author; nothing checks that an established rule has a falsifying criterion. Should it? | undecided | product (owner) |
| Q3 | A node whose stored details are already invalid cannot be changed by any dedicated action until repaired (BR-632). Should a dedicated action be able to repair it instead of refusing? | unconfirmed | product |
| Q4 | No criterion cites BR-1002, and the id-registry test covers only BR ids. Which criterion, with a test that fails if the rule is false, should establish it? | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), or on 2026-10-10 for BR-1002, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-628 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-631 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-632 | unconfirmed | established if refusing is kept; rewritten if a dedicated action may repair the node | Q3. |
| BR-633 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-1002 | unconfirmed | established | Q4. |
| BR-635 | unconfirmed | established if accepting is kept; rewritten if adding should warn or be refused | Q1. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-623, BR-626, BR-627. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
