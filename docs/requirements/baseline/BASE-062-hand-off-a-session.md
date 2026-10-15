---
id: BASE-062
type: baseline
role: intent
title: "Hand off a session"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-027
links:
  - {id: SPEC-095, type: supersedes}
---
## Hand off a session

> A session that stops before its work is done leaves the next session what it needs: next steps, decisions, changed files, and any failing check.

Scope: writing a handoff. Reading it back is "Resume a session"; the stop-time check of the same command is "Account for a resume ticket".

### Behaviour

**Command.** A session records a handoff, either from one prepared file or from separate fields (next steps, decisions with an optional confidence, files, task references, one failing check with its output), optionally naming the plan it belongs to and who leaves it.

**Constraint.** At least one next step. One way of giving the fields, not both. A named plan must be a live plan (BR-338); without one, the parent is the single requirements document, or nothing when there is none, and a corpus with several requirements documents needs a plan named (BR-339). Only this command can create a handoff.

**Event.** `HandoffRecorded` (a new knowledge document of the handoff kind, version 1, one audit entry).

### Terms used here

- **Handoff**, **ticket item**: defined in the branch glossary.

### Boundary notes

- The handoff's text is generated from its fields; there is no way to write its body by hand, so what is resumed is exactly what was recorded.
- Whether the handoff lands approved at once is autonomy's ledger auto-approval; the observable result with the default setting is stated in BR-333.
- Archiving old handoffs is hygiene's archive sweep.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Ledger auto-approval (handoffs land approved) | on | project settings maintainer (autonomy) | 2026-10-09 |
| Longest key decision | 300 characters | engineering (code) | 2026-10-09 |
| Longest failing-check output kept | 2,000 characters | engineering (code) | 2026-10-09 |

### Depends on

- corpus: document creation, identifier resolution, the foreign-corpus write guard.
- autonomy: ledger auto-approval.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Who leaves a handoff is whatever identity is given; it is not compared with any claim or session (BR-342). Should it have to match the caller's resolved identity or one of its claims? | undecided | product |
| Q2 | Task references and file names are kept as written and never checked (BR-343). Should a handoff naming a task that does not exist be refused? | undecided | product |
| Q3 | A plan that cannot be found is refused here as invalid input (exit 4, BR-338), but as not found (exit 3) when resuming. Which is meant? | undecided | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-334 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-338 | undecided | established if exit 4 is kept; rewritten if a missing plan is refused as not found (exit 3) | Q3. Held at undecided on 2026-10-10: AC-SL-12 of `spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles` pins the current refusal, but whether its exit code is intended is open. |
| BR-342 | undecided | established if the author stays unchecked; rewritten if it must match | Q1. |
| BR-343 | undecided | established if references stay unchecked; rewritten if unknown tasks are refused | Q2. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-333, BR-337. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
