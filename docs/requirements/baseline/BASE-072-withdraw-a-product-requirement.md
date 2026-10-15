---
id: BASE-072
type: baseline
role: intent
title: "Withdraw a product requirement"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Withdraw a product requirement

> A product owner removes a requirement from the requirements document, unless a criterion of any spec that is not deleted still says it covers it.

### Behaviour

**Command.** Someone names the requirements document and a requirement id, optionally forcing the removal.

**Constraint.** The requirement exists; otherwise the withdrawal is refused with outcome code 4 and nothing is written (BR-690). No criterion still covers it; otherwise the withdrawal is refused with outcome code 4 naming the forced removal, which succeeds and leaves the reference in place (BR-691). Every spec that is not deleted is checked, wherever it is filed: a spec has no parent (BR-1, BR-2), so coverage cannot be found by looking under the requirements document (BR-692). The document has not changed since it was read; otherwise the withdrawal is refused with outcome code 5 and not re-applied (BR-693).

**Event.** `ProductRequirementWithdrawn`: one version of the document and one audit entry, both naming 'system' as author (BR-693).

### Terms used here

- **Product requirement**, **requirements document**: defined in the branch glossary.

### Boundary notes

- A forced removal leaves the covering criteria's references as they are; they then cover nothing (BR-691). Rewriting them is the specification branch's action.
- That a spec has no parent (BR-1, BR-2) is the specification branch's rule, leaf "Create a spec"; this leaf records only what it means for the coverage check.

### Code not yet at the rules

BR-692 is the owner's decided contract (slice 3b, `spec-baseline-slice-3b-specs-belong-to-the-trees-through`, criterion AC-BLS3B-6). The code read on 2026-10-10 at commit 5e025ad2 does not do it yet: `requirement-service.ts`, `gatherDescendantAcRefs`, reads only specs whose parent is the requirements document, so a criterion on a spec with no parent does not stop the withdrawal. Plan `plan-baseline-slice-3b` carries the change (task `task-3b-consumers-tree-check-navigation-outline-stats-import`, blocked on the contract task). Until it lands, AC-BLS3B-6 fails and BR-692 is not what the product does.

Why BR-692 is live with enforcement guaranteed although the code lags: the baseline method this tree follows (`adr-the-product-is-a-baseline-tree-specs-are-implementations`, reference method "business-baseline") writes the decided rule into the tree first and has the code implemented against it, with the change set (here the slice 3b spec) holding the scope and the exit condition. Lifecycle says whether the rule is part of the product's intended current form (live), not whether the code already meets it; enforcement says who will stop a user getting past it once built (the product itself, guaranteed). Whether the code meets the rule is what confidence and the computed verification state report: BR-692 is held unconfirmed, and its state stays unverified, or contradicted once AC-BLS3B-6 runs and fails, until the code change lands.

### Current values

None.

### Depends on

- Declare a product requirement: BR-686 (requirements live only on a requirements document; naming another kind of document is refused with outcome code 4, an unknown one as not found, outcome 3), BR-688 (the shared write: one version and one audit entry by 'system', refused with outcome code 5 on a concurrent change, which BR-693 repeats for removal).
- specification, "Create a spec": BR-1, BR-2.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Today a checked spec whose stored criteria cannot be read is skipped by the coverage check, so it never stops a withdrawal. Should such a spec refuse the withdrawal instead? No rule states this yet. (suspected defect, issue #98) | undecided | product |
| Q2 | The history and audit entry name 'system' as author, not the caller. Should they name the caller, as baseline writes do? (suspected defect, issue #98) | undecided | product |

#### Rules held below established

BR-690, BR-691 and BR-693 match the code as read on 2026-10-09 (commit a248efe0) and re-read on 2026-10-10 at commit 5e025ad2 (`removeRequirement` and its shared write in `requirement-service.ts`; the one change to that file since a248efe0 added the migrate verb and left removal untouched). BR-692 states the decided contract ahead of the code (see "Code not yet at the rules"). For each, no live check-decided criterion yet passes that would fail if the rule were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms it: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-690 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-691 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-692 | unconfirmed | established | No question about intent (decided in slice 3b); waiting for the code change and for AC-BLS3B-6, which cites it, to pass. |
| BR-693 | unconfirmed | undecided | Q2 (the author clause). |
