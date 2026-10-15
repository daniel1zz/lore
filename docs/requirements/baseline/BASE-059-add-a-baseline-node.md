---
id: BASE-059
type: baseline
role: intent
title: "Add a baseline node"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Add a baseline node

> An author adds a node to the business tree or the architecture tree of the baseline, or gives a node a new label.

### Behaviour

**Command.** An author names a parent, the tree (business unless architecture is named), the kind of node, a label and a title, and optionally a file holding the node's body. Separately, an author gives an existing node a new label.

**Constraint.** Every node belongs to one of two trees, fixed when it is created (BR-979). A business node is a root, branch or leaf; an architecture node is a root, section, module card, standard or debt registry. An unknown tree, a kind that does not belong to the named tree, or a blank label is refused with outcome code 4 before anything is created (BR-613). The parent must fit the kind within the same tree: a root of either tree sits directly under the product's requirements document, business branches and leaves under a business root or branch, sections under the architecture root, and module cards, standards and debt registries under a section (BR-612). Nothing checks that labels or titles are unique (BR-615).

**Event.** `BaselineNodeAdded` (a new draft document with a creation version, BR-614), `BaselineNodeRelabelled` (a new version, BR-616).

### Terms used here

- **Baseline node**, **root**, **branch**, **leaf**, **label**: defined in the branch glossary.
- **Business tree**: the nodes that describe what the product does for its users (root, branches, leaves). A node with no tree named is a business node.
- **Architecture tree**: the nodes that describe how the product is built: an architecture **root**, **sections** under it, and under a section **module cards** (a description of one module), **standards** (nodes that hold architecture standard rules, ids AS-n) and a **debt registry** (a node that holds known exceptions to standards, ids AD-n).
- **Branch arming**: switching the citation gate on for one business branch; defined in Cite a baseline rule.

### Boundary notes

- Creating the node goes through the generic document creation of **corpus**; this leaf owns only the baseline-specific conditions: which tree, which kind, which parent.
- BR-979 is held here because the tree is chosen when the node is created. The parts of BR-979 that follow from the tree are acted on elsewhere: giving rules their AS-n and AD-n ids is **Write a business rule**, and leaving architecture nodes out of completeness is **Measure completeness**. Branch arming is **Cite a baseline rule**; only business branches can be armed.
- Writing a node's body later is a corpus revision (general edit), not an action of this branch.
- Approving a node is **review**.

### Current values

None.

### Depends on

- corpus (not yet written): document creation, addresses, deletion.
- Write a business rule: the shared rules on concurrent change, worktree scope and demotion (BR-631, BR-630, BR-628), and the id registry shared by BR-n, AS-n and AD-n.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should a label be unique across the tree, since readers refer to leaves by it? | undecided | product |
| Q2 | Relabelling a deleted node succeeds while rule writes on it are refused as not found. Which is meant? | unconfirmed | engineering |
| Q3 | From a worktree whose claim scopes a branch, rules can be added but the branch's new leaves cannot be created. Should the scope admit node creation and body edits? | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-10 (commit 70f2785d), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-612 | unconfirmed | established | No question about intent. Rewritten on 2026-10-10 to cover the architecture tree; no criterion cites it, so it waits for a check-decided criterion that fails if it is false. |
| BR-613 | unconfirmed | established | No question about intent. Rewritten on 2026-10-10 to cover the architecture tree; waits for a check-decided criterion that fails if it is false. |
| BR-614 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-615 | undecided | undecided | Q1: should a label be unique across the tree, given that readers and rule prefixes refer to leaves by it? |
| BR-616 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-617 | unconfirmed | established | Q2: should every dedicated write to a deleted node be refused as not found, as rule writes are? |
| BR-618 | unconfirmed | established | Q3: should the corpus scope admit node creation (and body edits) inside the scoped branch? |
| BR-979 | unconfirmed | established | No question about intent. Cited by AC-BLS3-1 and AC-BLS3-9 (slice 3a); held until those criteria carry a runner-recorded pass. |
