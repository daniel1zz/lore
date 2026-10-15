---
id: BASE-055
type: baseline
role: intent
title: "Assess a plan's outcome"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-067
links:
  - {id: SPEC-028, type: supersedes}
  - {id: SPEC-029, type: supersedes}
  - {id: SPEC-094, type: supersedes}
---
## Assess a plan's outcome

> An agent or a person gets an independent AI judgment of whether a plan delivered what its spec promised, and the judgment is saved for later readers.

Scope: the assessment of one plan. Whether a stale assessment blocks closing the plan is the plan-closing checkpoint's condition (execution, "Close a plan"); this leaf only says that assessing never refuses because of staleness.

### Behaviour

**Command.** An agent or a person asks for an assessment of a plan, optionally giving the code changes as a range or a file.

**Constraint.** The plan must exist and have at least one task. AI is always needed. The product computes facts itself, finds the plan's own commits when no diff is given, and checks the judge's answer: one corrective retry for an unreadable answer, criteria it names must be declared, file paths it names must exist at the assessed commit, and its scores are downgraded when it could not see enough. A criterion's reasoning longer than 300 characters is not a refusal: it is shortened to the limit ending with an ellipsis, the assessment is saved as usual (exit 0), and the saved assessment names the criteria whose reasoning was shortened, also in its text; only an unreadable answer takes the corrective retry (BR-1017).

**Event.** `PlanAssessed` (a new assessment record under the plan, linked to it, approved at once as a ledger record).

### Terms used here

- **Assessment**, **assessment verdict**, **deterministic facts**, **unverifiable finding**, **ledger record**, **fast-track**: defined in the branch glossary.

### Boundary notes

- The assessment is saved as a ledger record, so it is approved without review (BR-602).
- Assessing changes nothing on the plan or its tasks and blocks nothing; only the plan-closing checkpoint reads assessments.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Largest diff given to the judge before it is cut by file | 80,000 characters | project settings maintainer | 2026-10-09 |
| Share of tasks cut before confidence is marked low | more than 25% | product (built in) | 2026-10-09 |
| Longest reasoning kept per criterion before it is shortened | 300 characters | product (built in) | 2026-10-10 |
| Version of the judging instructions in use | 7 (6 still available) | product (built in) | 2026-10-09 |
| Whether AI may be used on a calling surface | on everywhere for this command unless a project setting says off | project settings maintainer | 2026-10-09 |

### Depends on

- Fast-track ledger records: the saved assessment is approved at once.
- Close a plan (execution): the only reader that can be blocked by an assessment.
- corpus (not yet written): creating and linking the record.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The original assess specification could not be read in this excavation (its name contains a word this pass must not open); its criteria may confirm several rules held here as unconfirmed. | unconfirmed | engineering |
| Q2 | Every verdict, including not met and inconclusive, ends with exit 0. Should a script be able to tell a failed plan from the exit code? | undecided | product |
| Q3 | Comments in the AI service still say no production caller supplies the diff source, which is no longer true, and the criterion meant to catch that comment names a test file that does not exist. | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-1017 on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`); `observed` is used for a rule measured in code that no criterion cites yet. Every rule of this leaf held below established is listed here; BR-543, BR-547, BR-549 and BR-552 are established.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-538 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-539 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-540 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-541 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-542 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-544 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-545 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-546 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-548 | unconfirmed | established | No question about intent. It lost its only citation in the 2026-10-09 citation audit (see the note below); which criterion, with a test that fails if the rule is false, should establish it? |
| BR-550 | unconfirmed | established | Should a link failure after saving be repaired or rolled back rather than leave an unlinked assessment? |
| BR-551 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-553 | undecided | established once Q2 is decided | Q2: should a script be able to tell a not-met or inconclusive verdict from the exit code alone? If the owner keeps exit 0, the rule stands as written and needs a falsifying criterion; if not, the rule is rewritten. |
| BR-1017 | observed | established | No question about intent; read from the code (see Evidence). The unit test `packages/core/src/assessment.test.ts:494-511` exercises the clipping, but no live criterion cites this rule yet. |

#### Evidence

| Rule | Code read | Observed in a throwaway corpus |
|---|---|---|
| BR-538 | adapters/cli/commands/assess.ts:182-200; service/corpus-service.ts:3527-3534 | exit 3 / 4 / 4 observed |
| BR-539 | adapters/cli/commands/assess.ts:163-173, 338-347 | exit 2 for --no-ai, for both flags, and for the configured brake |
| BR-540 | adapters/cli/commands/assess.ts:174-177, 240-317, 410 | exit 2 for both options, a missing file and a bad range |
| BR-541 | adapters/cli/commands/assess.ts:287-308; service/ai-provider-service.ts:1910 | — |
| BR-542 | adapters/cli/commands/assess.ts:323-331 | — |
| BR-543 | service/ai-provider-service.ts:1256 | — |
| BR-544 | service/ai-provider-service.ts:1385-1440; adapters/cli/commands/assess.ts:379-386 | — |
| BR-545 | service/ai-provider-service.ts:202-219, 1349, 1396 | — |
| BR-546 | service/ai-provider-service.ts:1264, 2036-2037 | — |
| BR-547 | service/ai-provider-service.ts:2001-2025 | — |
| BR-548 | service/ai-provider-service.ts:1925-1930 | — |
| BR-549 | service/ai-provider-service.ts:668-720, 1942 | — |
| BR-550 | adapters/cli/commands/assess.ts:402-425 | — |
| BR-551 | adapters/cli/commands/assess.ts:210-224 | — |
| BR-552 | service/ai-provider-service.ts:1295-1311, 2033 | — |
| BR-553 | adapters/cli/commands/assess.ts:433-473 | — |
| BR-1017 | core/src/assessment.ts:233 (300-character cap), 1666 (`clipOverlongReasoning`), 1849 (clipped criteria rendered in the text); service/ai-provider-service.ts:2024 (`reasoning_clipped` saved) | — |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-548. It lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
