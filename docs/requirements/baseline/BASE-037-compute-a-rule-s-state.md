---
id: BASE-037
type: baseline
role: intent
title: "Compute a rule's state"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-11
tags: []
parent: BASE-081
---
## Compute a rule's state

> Anyone lists the baseline tree and, when asked, sees for each rule whether evidence that still holds backs it, and what that answer was computed from.

### Behaviour

**Command.** Someone lists the tree (all of it or one subtree), optionally with each rule's verification state, or asks for one rule's state.

**Constraint.** Read-only. The state is computed on request from the citing criteria, their latest runner-attested runs and version control (BR-665, BR-666); only runner-attested pass or fail runs count, the latest per criterion (BR-667). Evidence reaches a criterion through its task's plan and spec (BR-668), and if any evidence row of a task is malformed, none of that task's evidence counts (BR-675). A pass that cannot show its code unchanged is unknown, never verified: no commit, uncommitted changes, a commit not in history or no version control (BR-666), no code anchors on the citing spec (BR-671); an anchor in an old form still counts by its path (BR-672). An unknown rule id is refused (BR-673); a subtree root that is not a baseline node is refused (BR-674).

**Event.** None; read-only. Each state is shown with the inputs it was decided from (BR-669); the corpus status report shows only counts (BR-670).

### Terms used here

- **Verification state**, **citing criterion**, **rule lifecycle**: defined in the branch glossary.

### Boundary notes

- The evidence and its runner record are produced by **execution**; citations by **specification**.
- The plain listing gives each node's kind, label, address, status and, on every node that holds rules (business leaf, architecture standard, debt registry), its rules counted by lifecycle, depth-first with children ordered by address (BR-674).

### Current values

None.

### Depends on

- specification, "Cite a baseline rule": which criteria cite a rule.
- execution (not this branch): evidence, runner records, plan lineage.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Asking for one unknown rule's state ends with outcome code 4; showing the same unknown rule ends with outcome code 3. Should both say not found? (suspected defect, issue #98) | undecided | engineering |
| Q2 | One malformed evidence row stops every evidence row of its task from counting (BR-675). Should the valid rows still count, with the malformed one reported? (suspected defect, issue #98) | undecided | engineering |
| Q3 | States are computed only for rules on business leaves: a standard rule (AS-n) may be cited (BR-980) but never gets a state, and asking for one is refused as not held by any live leaf (BR-673). Should standard rules get a computed state? (suspected gap, issue #136) | undecided | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0); BR-674 was re-read on 2026-10-10 at commit 5e025ad2, after the fix for issue #125 (commit 6f8335e0) made the listing print rule counts on standards and debt registries as well as on leaves. For each, no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms the code reading: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-667 | unconfirmed | established | No question about intent; no criterion cites it yet. Waiting for a check-decided criterion that fails if this is false. |
| BR-671 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-672 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-673 | unconfirmed | undecided | Q1, Q3. |
| BR-674 | unconfirmed | established | No question about intent (issue #125 is closed in code); waiting for a check-decided criterion that fails if this is false. |
| BR-675 | unconfirmed | undecided | Q2. |
