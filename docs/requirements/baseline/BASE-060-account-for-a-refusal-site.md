---
id: BASE-060
type: baseline
role: intent
title: "Account for a refusal site"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Account for a refusal site

> An author records, for each refusal site a leaf's commands can reach, which rule of the leaf accounts for it, or why it is not business behaviour; and declares the commands the leaf answers for.

### Behaviour

**Command.** An author names a leaf and either a site with rules or a non-business reason, sites to unmap, commands to declare or commands to drop. With nothing to change, the request only asks whether the session may write the leaf (BR-657).

**Constraint.** A site gets exactly one of rules or a reason (BR-655); rules must be rules of this leaf, in any lifecycle, and a reason must not be blank (BR-654); removals must name what is there, and command names must not be blank but are not checked against the product's commands (BR-656).

**Event.** `SiteMapUpdated`: one version of the leaf and one audit entry naming the actor and what was set, removed, added and dropped (BR-658).

### Terms used here

- **Refusal site**, **site map**, **census**, **gap**: defined in the branch glossary.

### Boundary notes

- Whether the map is complete is measured by "Measure completeness". A rule that is mapped but not live does not count there (BR-660).
- Sites owned by another branch are recorded as a non-business reason naming the owning leaf; the product does not check that reason.

### Current values

None.

### Depends on

- Measure completeness: the census and the verdict.
- Write a business rule: BR-630, BR-631, BR-632, BR-628.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A site can be mapped to a retired rule of the leaf; the map accepts it and completeness then counts it as a gap. Should the map refuse it? | undecided | product |
| Q2 | A reason claiming another branch owns a site is free text. Should 'owned by' be a checked reference to that leaf and rule? | undecided | product |
| Q3 | A command name is not checked when it is declared; an unknown one is reported only when completeness is measured. Should an unknown command name be refused when it is declared? | undecided | product |
| Q4 | BR-657 lost its only citation in the 2026-10-09 citation audit: the fidelity judge found the citing criterion did not assert the rule's main claim. Which criterion, with a test that fails if the rule is false, should establish it? | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms the code reading: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-654 | unconfirmed | undecided | Q1 (its clause accepting a rule of the leaf in any lifecycle). |
| BR-655 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-656 | unconfirmed | undecided | Q3. |
| BR-657 | unconfirmed | established | Q4. |
| BR-658 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
