---
id: BASE-133
type: baseline
role: intent
title: "Withdraw an acceptance criterion"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-10
tags: []
parent: BASE-064
---
## Withdraw an acceptance criterion

> An author withdraws one acceptance criterion from a spec.

### Behaviour

**Command.** An author withdraws a named criterion from a spec, optionally insisting even though evidence refers to it.

**Constraint.** The criterion exists, and evidence from the spec's planned work does not refer to it unless the author insists.

**Event.** `AcceptanceCriterionWithdrawn`. The spec's status does not change.

### Terms used here

- **Dangling evidence reference**: evidence recorded against a criterion id the spec no longer declares. It is shown when a spec's criteria are listed and is never cleaned up automatically.

### Boundary notes

- Withdrawing is the only way to retire a criterion. Its citations of baseline rules go with it.
- The evidence guard looks only at tasks in plans under the spec.

### Current values

None.

### Depends on

- Declare an acceptance criterion: concurrent edits are arbitrated the same way, and pending missing-test declarations come from there.
- execution (not yet written): task evidence is owned there; withdrawal leaves it in place.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Withdrawing criteria from an approved spec leaves it approved, even when that takes it below the minimum count or uncovers a required check kind it was approved with. Adding also leaves it approved but revising returns it to draft. Is this asymmetry intended? Approval then certifies the criteria as they stood when approved, not as a reader sees them now. | undecided | product |
| Q2 | The evidence guard only looks at tasks in plans under the spec. Evidence from unplanned (ad hoc) tasks governed by the spec does not protect a criterion. Engineering already names this as a known gap. Should it be closed? | undecided | product |



#### Downgraded in pilot v2 — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Was | Open question |
|---|---|---|
| BR-45 | observed | Must withdrawing a criterion the spec does not declare be refused (rather than treated as already done)? |
| BR-48 | observed | Must withdrawing a criterion leave an approved spec approved, even though the approved set of criteria shrinks? |
| BR-49 | observed | Must each withdrawal add exactly one history entry and lose to a concurrent writer as stale? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-50. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
