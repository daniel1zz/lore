---
id: BASE-119
type: baseline
role: intent
title: "Check the binary is current"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
---
## Check the binary is current

> A maintainer or pre-push hook learns whether the program issuing every other verdict was built from this checkout's current commit.

Scope: the build check of the status command. It needs only the project's git history, never the corpus.

### Behaviour

**Command.** Someone asks the status command to check the binary.

**Constraint.** The commit carried inside the program is compared with the checkout's current commit.

**Event.** `BinaryChecked` (nothing recorded).

### Terms used here

- **Build provenance**: defined in the branch glossary.

### Depends on

- distribution: the build that embeds the commit, and the pre-push hook that runs this check first.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A program built from a newer commit than the checkout's (after switching to an older branch) is also reported stale. Intended? | undecided | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-437 | undecided | established | Should a program newer than the checkout be treated as stale? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-435, BR-436. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
