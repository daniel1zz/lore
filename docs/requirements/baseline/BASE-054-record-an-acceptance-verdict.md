---
id: BASE-054
type: baseline
role: intent
title: "Record an acceptance verdict"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-067
---
## Record an acceptance verdict

> An acceptance run (usually an agent) records whether a plan's delivered product is accepted, so the plan-closing checkpoint can read it without a person.

Scope: recording and reading a plan's acceptance verdict, and what counts as must-have accepted. Whether a plan needs one before it can close is the plan-closing checkpoint's condition (execution, "Close a plan").

### Behaviour

**Command.** An acceptance run records a verdict file for a plan; anyone shows a plan's latest verdict.

**Constraint.** The verdict must be well-formed and the target must be a plan. A verdict record can be created only through this action.

**Event.** `AcceptanceVerdictRecorded` (a new verdict record linked to the plan as informing it, approved at once as a ledger record).

### Terms used here

- **Acceptance verdict**, **must-have tier**, **must-have accepted**, **ledger record**: defined in the branch glossary.

### Boundary notes

- The verdict record is a ledger record and is fast-tracked (BR-602).
- The plan-closing checkpoint reads the same latest verdict this leaf shows.

### Commands and coverage

This leaf answers for `uat record` and `uat show`. The site census cannot reach either subcommand (they are declared outside the form the census follows; suspected product defect), so the leaf declares no command and coverage reports it as unmeasured. Each rule was checked against the code and its refusals observed in a throwaway corpus.

### Current values

None adjustable. The verdict format is fixed by the product.

### Depends on

- Fast-track ledger records: the saved verdict is approved at once.
- Close a plan (execution): the reader of the verdict.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A verdict whose must-have items are all unverified, whose coverage numbers contradict each other, or that was self-verified, still counts as must-have accepted. Intended? | undecided | product (owner) |
| Q2 | An invalidated verdict record is still read as the plan's verdict. | unconfirmed | engineering |
| Q3 | Creation is restricted to this action, but the agent tool route's generic edit can replace a saved verdict's content, and the edited record is re-approved at once. | unconfirmed | engineering |
| Q4 | The census cannot reach the two subcommands. | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-564 | unconfirmed | established | Should the saved record be removed instead of left for a manual repair? |
| BR-565 | unconfirmed | established | Should showing a non-plan target be refused like recording against one? |
| BR-567 | undecided | undecided | Should unverified must-have items, impossible coverage figures or a self-verified run block must-have acceptance (Q1)? |
| BR-568 | unconfirmed | established | Should an invalidated verdict be skipped by the reader and by the plan-closing checkpoint (Q2)? |
| BR-569 | unconfirmed | established | Should edits to a verdict's details be refused like its creation (Q3)? |
| BR-570 | undecided | undecided | Should the verdict sit under the plan in the tree, as an assessment does? |

#### Evidence

| Rule | Code read | Observed in a throwaway corpus |
|---|---|---|
| BR-560 | core/src/uat.ts:64-98; service/uat-service.ts:112-120; adapters/cli/commands/uat.ts:51-57 | exit 4 and exit 2 observed |
| BR-561 | service/uat-service.ts:127-150 | exit 3 and exit 4 observed |
| BR-562 | service/uat-service.ts:153-170 | exit 0 observed; record approved at version 1 |
| BR-563 | service/corpus-service.ts:1199-1213 | — |
| BR-564 | service/uat-service.ts:163-182 | — |
| BR-565 | service/corpus-service.ts:3625-3665; adapters/cli/commands/uat.ts:91-121 | exit 0 / 3 / 0 observed |
| BR-566 | core/src/uat.ts:121-128 | — |
| BR-567 | core/src/uat.ts:121-128; core/src/uat.ts:148 | 'P0 accepted: yes' observed for exactly this verdict |
| BR-568 | service/corpus-service.ts:3640-3652 | — |
| BR-569 | service/corpus-service.ts:2400-2425 (no verdict guard on edit); adapters/mcp/tools.ts:414-423 | — |
| BR-570 | service/uat-service.ts:153-158 | parent empty observed |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-561. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
