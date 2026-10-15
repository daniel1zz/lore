---
id: BASE-099
type: baseline
role: intent
title: "Declare a product requirement"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Declare a product requirement

> A product owner or agent adds a numbered requirement, with a priority, to the product's requirements document, marks a requirement as migrated to the baseline rule that now states it, and lists the requirements declared there.

Scope: the three requirement actions that act on the requirements document's list: add, mark as migrated, and list. Marking as migrated belongs here because it edits one entry of that same list, through the same write as adding; it is part of declaring a requirement (the parent's "declaring, listing and withdrawing"), recording which rule now states it. The parent's child row names only adding, its main action.

### Behaviour

**Command.** Someone names the requirements document, a requirement id, a statement and a priority (optionally the rule it is migrated to); or names a requirement and a baseline rule to mark it as migrated; or asks for the list.

**Constraint.** For all three actions the target is a requirements document (BR-686); the requirement is well-formed and its id unused (BR-683); its statement is measurable (BR-684) unless the project switched that check off (BR-685). Marking as migrated names an existing requirement and a live baseline rule with a well-formed id; marking it again replaces the earlier rule (BR-1001).

**Event.** `ProductRequirementDeclared` or `ProductRequirementMigrated`: one version of the requirements document and one audit entry each (BR-688). Listing records nothing; it shows the requirements in declaration order, each marked one with the rule it was migrated to (BR-687).

### Terms used here

- **Product requirement**: defined in the branch glossary.
- **Migrated requirement**: a requirement marked with the baseline rule that now states it.

### Boundary notes

- A spec's criterion says which requirements it covers (specification). Which requirements are covered, and the status check that fails on an uncovered top-priority requirement, are **hygiene** ("Check the requirements document"). For a migrated requirement, coverage comes from citations of its rule (BR-983, hygiene); this leaf only records the mark.
- The parent keeps the cross-cutting rules for dedicated baseline writes (re-application after a concurrent change, demotion of an approved node) on "Write a business rule". The requirements document is not a baseline node, so its own write rules are stated here (BR-688).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Measurable-statement check on new requirements | on (new project) | project settings maintainer | 2026-10-09 |
| Maximum requirements per document | 100 | product code | 2026-10-09 |

### Depends on

- corpus (not yet written): the requirements document.
- product baseline, "Write a business rule": the live rules a requirement can be migrated to.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Requirement writes name 'system' as author in the history and the audit log, not the caller. | unconfirmed | engineering |
| Q2 | Adding or migrating a requirement on an approved requirements document leaves it approved, so its approval does not certify the requirement list. Acceptable? | undecided | product (owner) |
| Q3 | A stored requirement list that no longer reads as valid is treated as empty, and the next addition replaces it. | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-686, BR-687, BR-688 and BR-1001 read on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). Every rule of this leaf held below established is listed here or in the notes under the table.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-688 | unconfirmed | established | Q1, Q2 |
| BR-689 | unconfirmed | established | Q3 |
| BR-1001 | unconfirmed | established | No question about intent: no live criterion cites it; a test that marks a requirement with a missing, deprecated or retired rule and expects outcome 4 would establish it. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-686. Its only citation was lost when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?


**BR-687 held at unconfirmed after the post-remediation fidelity sample (2026-10-09):** its only citation was judged unfaithful (seed 20261010 sample). Open question: which criterion, with a test that fails if the rule is false, should establish it?
