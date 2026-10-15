---
id: BASE-128
type: baseline
role: intent
title: "Check resolution labels"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-002
links:
  - {id: SPEC-099, type: supersedes}
---
## Check resolution labels

> A maintainer finds every defect report whose resolution label on GitHub disagrees with the resolution the corpus computes.

Scope: the label-check mode (`--verify`) of the list command. The ordinary listing is the leaf "List defect reports".

### Behaviour

**Command.** A maintainer asks for the label check, from the GitHub list or from this corpus.

**Constraint.** Only reports that have a task and a GitHub issue are checked. The corpus is the authority; a label is only compared, never adopted. The check writes nothing.

**Event.** None (a query). The outcome is the list of differences and the exit code.

### Terms used here

- **Resolution label**, **drift**, **resolution**, **ingested**: defined in the branch glossary.

### Boundary notes

- Labels are written only by the resolve leaf (BR-533); this leaf only reads them.
- The resolution compared is the one the list leaf computes (BR-510).

### Depends on

- Resolve a defect report: the only writer of labels.
- List defect reports: the computed resolution and the GitHub read.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Filing sets no label, and a resolution that changes through a link or archiving does not update the label, so the check reports most reports as drift. Should filing and those changes set the label, or the check ignore a missing label? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-519 | unconfirmed | undecided | Should filing set 'resolution:open', and should computed changes update the label, or should the check skip a missing label? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-518. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
