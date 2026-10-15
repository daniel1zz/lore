---
id: BASE-134
type: baseline
role: intent
title: "Run an evaluation scenario"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-067
links:
  - {id: SPEC-013, type: supersedes}
---
## Run an evaluation scenario

> An owner or an agent measures one aspect of the corpus's health and gets a pass or a fail that a script can act on.

Scope: the six evaluation scenarios. The checks of tree structure and link integrity that repair things belong to hygiene; this leaf only measures.

### Behaviour

**Command.** A caller runs one scenario.

**Constraint.** Each scenario has a fixed pass condition (BR-572). A measurement that fails, including a failure to read the corpus or, for the migration scenario, a missing source folder, is reported as a failed scenario (exit 1), never as an error (BR-571, BR-958). A missing required argument is a usage error (exit 2, BR-571).

**Event.** None for five scenarios. The migration scenario imports into the corpus (BR-574, suspected defect).

### Terms used here

- **Evaluation scenario**: defined in the branch glossary.

### Commands and coverage

This leaf answers for `eval migration`, `eval tree`, `eval links`, `eval types`, `eval fts` and `eval placeholders`, and declares all six commands. Since the census fix (issue 94) the site census reaches all six subcommands. Measured on 2026-10-10 the leaf's coverage is incomplete: 61 sites, 16 gaps, 9 not measured. The 16 gaps are store-level refusals (duplicate link, duplicate slug, missing document, stale version, parent cycle, store error) that the census began to reach when it learned to follow injected functions (issue 104); they are reached through the migration scenario's import and are not yet mapped to rules or exclusions. Each rule was checked against the code; the suspected defects were observed in a throwaway corpus.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Search recall needed to pass | 0.8 at the top 5 results | product (built in) | 2026-10-09 |
| Minimum documents per type | one requirements document and one spec | product (built in) | 2026-10-09 |

### Depends on

- corpus and hygiene branches: what the scenarios measure.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should the migration scenario run the import as a trial only, as evaluation is described as read-only? | unconfirmed | engineering |
| Q2 | Should the search scenario accept the project's own queries? | unconfirmed | product |
| Q3 | A missing or unreadable source folder makes the migration scenario fail with exit 1 (BR-958). Should it be a usage error (exit 2) like a missing argument, since nothing was measured? | undecided | product |
| Q4 | The migration scenario never scans the source for secrets, although it offers an option to skip the scan (BR-575). Should it honour the secret scan? | unconfirmed | engineering |
| Q5 | Which mapping should the 16 store-level sites the migration scenario reaches get: rules of this leaf, rules of the corpus branch, or non-business exclusions? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-571 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-572 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-573 | unconfirmed | established | Should the scenario take the project's own queries, or be skipped where its fixtures do not apply (Q2)? |
| BR-574 | unconfirmed | established | Should the scenario run as a trial and leave the corpus unchanged (Q1)? |
| BR-575 | unconfirmed | established | Q4. |
| BR-958 | unconfirmed | established | Q3. |

#### Evidence

| Rule | Code read | Observed in a throwaway corpus |
|---|---|---|
| BR-571 | adapters/cli/commands/eval.ts:56, 67-391 | exit 0 and exit 1 observed |
| BR-572 | eval/scenarios/tree-consistency.ts:184; link-integrity.ts:213; type-distribution.ts:83-90; fts-recall.ts:130-133; placeholder-parse.ts:354; migration-coverage.ts:150-185 | — |
| BR-573 | eval/scenarios/fts-recall.ts:162-191; adapters/cli/commands/eval.ts:306 | exit 1 observed in a fresh corpus |
| BR-574 | eval/scenarios/migration-coverage.ts:158-163; eval/CLAUDE.md:9 | the corpus grew from 1 to 2 documents |
| BR-575 | eval/scenarios/migration-coverage.ts:161; adapters/cli/commands/eval.ts:44, 62 | secret imported by the scenario; flagged by migrate v1 --dry-run |
| BR-958 | eval/scenarios/migration-coverage.ts:105-118 (missing folder fails), 143-154 (no readable files passes) | — |
