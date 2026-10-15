---
id: BASE-070
type: baseline
role: intent
title: "Read a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-004, type: supersedes}
  - {id: SPEC-015, type: supersedes}
  - {id: SPEC-032, type: supersedes}
  - {id: SPEC-033, type: supersedes}
  - {id: SPEC-036, type: supersedes}
---
## Read a document

> Anyone reads one document, named by its id, a short id, its name or its number.

Scope: showing one document, and resolving a reference to a document. Resolution is shared by every action of every branch; their census sites for it are mapped as owned by this leaf.

### Behaviour

**Command.** A reader asks for a document by any accepted reference.

**Constraint.** The reference must name exactly one document: by permanent id, name, or a unique prefix of at least 6 characters (BR-713), or, held unconfirmed, by a spec or decision number (BR-714). An ambiguous prefix is refused with exit code 4 (BR-715); an unknown reference ends with exit code 3, and a deleted document is never matched by a prefix (BR-716). A deleted document named directly is still shown in full (BR-717, held unconfirmed as a suspected defect).

**Event.** None: reading writes nothing (BR-718, held unconfirmed). What is shown:

- the body, with placeholders expanded unless the raw form is asked for; an unknown placeholder is dropped with a warning (BR-720, held unconfirmed);
- a warning line on an invalidated document (BR-719);
- the document's parents, siblings, children and other links (BR-718); a spec has no parent (specification, BR-1), so it shows none. A document with no parent shows no siblings in the code read at commit 5e025ad2 (`corpus-service.ts`, the navigation builder); specs stored before the no-parent contract keep the requirements document as parent, and show it and its other children, until the spec-parents upgrade is applied ("Upgrade the corpus in place", BR-1009);
- on a spec, an Implements section listing each cited rule with its node and citing criteria; on a node that holds rules, an Implemented by section listing every citing criterion with its spec's status and a count. Both are computed from citations at read time and drop nothing (BR-1008).

### Boundary notes

- How an invalidated document is marked is shown here (BR-719); whether it is listed is list's and search's.
- A deleted document is still readable by direct reference (BR-717); this is held as a suspected defect (Q1).
- BR-1008 is held here although it concerns only specs and baseline nodes, because it describes what the read command prints and adds no condition to any type's write. Declaring citations belongs to **specification** ("Cite a baseline rule"); the rules being cited and their lifecycle belong to **product-baseline**. The read through the agent tool interface does not yet carry these two sections (issue #134); BR-1008 describes the command-line read.

### Depends on

- Invalidate a document: the warning line (BR-719).
- specification, "Create a spec": BR-1 (a spec has no parent).
- specification, "Cite a baseline rule": the citations counted by BR-1008.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should a deleted document be not found, or shown with a deleted mark (BR-717)? (suspected defect) | undecided | product |
| Q2 | The 6-character prefix floor is decided (BR-713). A reference shorter than that is looked up as a name only, and when it is not found it gets no hint that it may be a shortened id (BR-716). Should such input get that hint too? This is a possible extension, not a doubt about current behaviour: BR-713 and BR-716 describe today's behaviour and stay established; no rule changes until this is decided. | undecided | product |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09; BR-718's example was corrected on 2026-10-10 (commit 5e025ad2) so it no longer shows a requirements document above a spec. For each, no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms the code reading: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-714 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-717 | unconfirmed | undecided | Q1. |
| BR-718 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-720 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |

BR-1008 is held at established: AC-BLS3B-4 (spec `spec-baseline-slice-3b-specs-belong-to-the-trees-through`) is a check-decided criterion citing it, and its test (`spec-implements-view.bun.test.ts`) fails if a spec's Implements or a leaf's or standard's Implemented by section is missing, drops a citation of a missing rule, filters a spec by status, or miscounts. It was raised from undecided on 2026-10-10 after reading `spec-relations.ts` and that test.
