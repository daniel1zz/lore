---
id: BASE-108
type: baseline
role: intent
title: "Measure completeness"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Measure completeness

> An author or a check lists the refusal sites a command can reach, and finds out whether a leaf, or every leaf under a branch, accounts for all of them.

### Behaviour

**Command.** Someone asks for the census of one command, or for the completeness of a leaf, branch or root.

**Constraint.** The census reads the product's source (BR-663); command names must resolve (BR-664); the target must be a baseline node (BR-662). A leaf is complete only when every identified and every not-measured site of its declared commands is accounted for (BR-659, BR-660).

**Event.** None; read-only. The outcome code carries the verdict (BR-661).

### Terms used here

- **Census**, **refusal site**, **not measured**, **gap**, **site map**, **completeness**: defined in the branch glossary.

### Boundary notes

- The census is a static reading of the source, so it over-approximates: it may list sites a command cannot actually reach. Those are mapped with a non-business reason saying so.
- The census also has a known blind spot in the other direction, stated in BR-659. It follows calls at most 12 deep (see Current values) and walks each function only once, from where it first meets it, so a refusal site beyond that depth on that walk is left out entirely: it is neither listed nor reported as not measured, and a leaf can be reported complete without accounting for it (suspected defect, issue #112).
- Functions and services handed in at run time are followed to the implementations bound to them. When exactly one implementation is found it is followed and nothing else is recorded; when several are found, all are followed and the call is also listed as one not-measured site; when none can be resolved, the call is one not-measured site (BR-659).
- Arming the citation gate on a branch is the specification branch's decision, not made here.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Depth of calls the census follows from a command | 12 | product code | 2026-10-10 |
| Start-up wiring names listed separately and never counted | product's fixed list | product code | 2026-10-09 |

### Depends on

- Account for a refusal site: the site map and the declared commands read here (BR-654, BR-655, BR-656).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | One unknown command name on one leaf fails the whole branch measurement with no per-leaf report. Should it be reported per leaf instead? | undecided | product |
| Q2 | The census needs the source and the developer tools, so a project that installed the product cannot measure completeness. Is that intended for good? | undecided | product |
| Q3 | A chain of calls cut at the depth limit leaves no trace (BR-659, issue #112). Should the cut be listed as one not-measured site, so completeness cannot pass over it? | defect | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0; BR-659 re-read on 2026-10-10 after the #104 fix), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms the code reading: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-659 | unconfirmed | established | No question about intent for the listing itself; the depth-limit clause describes a suspected defect (Q3, issue #112), and no check-decided criterion fails if that clause is false. |
| BR-661 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-662 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-663 | unconfirmed | undecided | Q2. |
| BR-664 | unconfirmed | undecided | Q1 (its clause that one such name fails the whole measurement). |

BR-660 is held at established: it measures completeness against the sites the census lists, which its citing criteria test. BR-659 was restated on 2026-10-10 to name the depth limit and lowered to unconfirmed for that reason.
