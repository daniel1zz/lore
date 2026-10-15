---
id: BASE-148
type: baseline
role: intent
title: "Print a governance topic"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-046
links:
  - {id: SPEC-096, type: supersedes}
  - {id: SPEC-083, type: supersedes}
---
## Print a governance topic

> A session hook, agent or person reads one governance text exactly as the running program ships it, so the text can never be older or newer than the binary.

### Behaviour

**Command.** Print a named governance topic.

**Constraint.** Exactly one known topic; retired topics are refused with a pointer to their replacement. No corpus is needed.

**Event.** None: nothing is written.

### Terms used here

- **Governance topic**, **shipped assets**: defined in the branch glossary.

### Boundary notes

- What each topic says and which hook prints it: context and session.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Known topics | seat briefing, project instructions contract, bootstrap framing line | product | 2026-10-09 |
| Retired topic | corpus workflow (now shipped as context fragments) | product | 2026-10-09 |

### Depends on

- context (not yet written): the content and the fragments that replaced the retired topic.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A shipped text that cannot be read is reported as an input error (exit 4) although the caller's input was valid. Should it be exit 1? | undecided | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-855 | unconfirmed | established | No question about intent: the missing criterion: no test asks for an unknown topic. |
| BR-857 | undecided | established | Exit 4 means the caller's input was invalid; here the installation is broken. Should this be exit 1? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-853, BR-856. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
