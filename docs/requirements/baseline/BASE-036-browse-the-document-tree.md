---
id: BASE-036
type: baseline
role: intent
title: "Browse the document tree"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-11
tags: []
parent: BASE-066
links:
  - {id: SPEC-015, type: supersedes}
  - {id: SPEC-031, type: supersedes}
---
## Browse the document tree

> Anyone sees documents under their parents, or finds documents with no parent.

### Behaviour

**Command.** A reader asks for the tree, from a named document or from the default root, optionally with a depth; or asks for the orphans.

**Constraint.** With no document named, the tree starts at the business baseline root when one exists (an architecture root never is the default, BR-981), and otherwise at the strategy document (the first-created requirements document); a document named explicitly is always the start. The command line, its help text, the HTTP tree read and the MCP tree tool share this default (BR-982). The tree shows three levels below its start unless another depth is asked; a depth that is not a positive whole number is a usage error (exit 2). With nothing named and neither a baseline root nor a requirements document in the corpus, it ends with exit code 3 and says to create one; an unknown document named also ends with exit code 3 (BR-753). The tree follows recorded parents, not links, leaves out deleted documents and keeps invalidated ones with a mark (BR-754). Asked for orphans, it lists every document that should have a parent but has none or whose parent is gone, and ends with exit code 3 when there is at least one, 0 when there is none (BR-755).

**Event.** None: browsing writes nothing.

### Terms used here

- **Baseline root**: the root node of the business baseline tree (not the architecture tree), placed directly under the requirements document. When several exist, the one created first is used.
- **Strategy document**: the first-created requirements document; it was the default root before the baseline tree existed.
- **Orphan**: a document that should have a parent but has none, or whose recorded parent no longer exists.

### Boundary notes

- A plan's tree also shows its phases; phases are execution's.
- Repairing orphans and tree layout is hygiene's (tree check and fix).
- Which document is the baseline root is decided once for the whole product and shared with session start ("Start a session", BR-981), so the tree and the session snapshot always agree.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Levels shown below the start when no depth is asked | 3 | product release | 2026-10-10 |

### Depends on

- Product baseline: the baseline root used as the default start.
- session, "Start a session": the same choice of root (BR-981).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Because removing a parent link leaves the recorded parent (BR-765), the tree can disagree with the links. Which is the truth? | unconfirmed | product |
| Q2 | Finding orphans ends with exit code 3, as a failure would, although it is a report (BR-755). Should it? | undecided | product |
| Q3 | CLOSED 2026-10-11: only the business root qualifies (issue 122 fixed in commit 687141c0; pickBaselineRoot requires tree absent or business), so an earlier architecture root never becomes the default (BR-982). | — | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-10 (commit 70f2785d), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-753 | unconfirmed | established | No question about intent. Rewritten on 2026-10-10 to defer the default start to BR-982; waiting for a check-decided criterion that fails if it is false. |
| BR-754 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-755 | unconfirmed | established | Q2: should finding orphans be a failure exit, given it is a report? |
| BR-982 | unconfirmed | established | Q3 closed (code matches since 687141c0). Cited by AC-BLS3-3 (slice 3a); held until that criterion carries a runner-recorded pass. |
