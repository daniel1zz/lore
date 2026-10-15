---
id: BASE-074
type: baseline
role: intent
title: "Check the requirements document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
---
## Check the requirements document

> A product owner or pre-push hook learns which P0 requirements no acceptance criterion covers, and which requirements documents or baseline nodes have grown past their size budget.

Scope: the requirement-coverage check and the size check of the status command. Coverage runs over every requirements document in the corpus. The size check measures every requirements document and, since slice 3b, every baseline node, under one flag and one exit code. This leaf owns only the measuring: what a baseline node holds is product-baseline's, as the parent's Boundary says.

### Behaviour

**Command.** Someone asks the status command to check requirement coverage, the size budget, or both.

**Constraint: coverage.** Coverage is decided per requirement, in one of two ways:
- A requirement **not migrated** is covered when at least one acceptance criterion of a spec that counts names it; requirements no criterion names are listed as uncovered, P0 ones separately (BR-418). Which specs count is BR-420: every spec that is not deleted, whatever its status and wherever it is filed (see the Known gap note).
- A requirement **migrated** to a baseline rule is covered exactly when a script-mode criterion of any spec in the corpus that is not archived or deprecated cites that rule and the rule is live (BR-983).

The coverage report lists migrated and unmigrated requirements separately (BR-983), and fails with exit code 3 when any requirements document has an uncovered P0 requirement, naming each one and how to cover it; uncovered requirements of lower priority never fail it and appear only in the machine-readable output (BR-419). A requirements document whose requirement list cannot be read is treated as having none, so it passes, and a spec whose criteria cannot be read contributes no coverage; neither is reported (BR-421, suspected defect).

**Constraint: size.** Every comparison passes exactly at the budget and finds one over (one character, or for a leaf's rule count one rule).
- A requirements document's body is at most its whole-document budget (BR-422).
- Each free-text field of a requirements document outside its structured lists stays within the free-text budget (BR-423). Outline entries are not measured: the outline is read-only history.
- A requirements document's budget is read from the document itself, each limit falling back to its default on its own. A budget that cannot be read is treated as absent, with no warning, and the document is then measured only on its whole body (BR-425).
- Each baseline node stays within the budget of its kind: a leaf at most 16,000 characters and 30 rules, a branch at most 16,000 characters, an architecture standard at most 8,000 characters. A finding names the node, kind, measured size and cap (BR-1010).

Any size finding fails the check with exit code 3.

**Event.** `RequirementsChecked` (nothing recorded).

### Terms used here

- **Requirement coverage**, **size budget**, **finding**: defined in the branch glossary.
- **Migrated requirement**: a requirement marked as now expressed by one baseline rule (BR-n). Its coverage comes from that rule's citations instead of from criteria that name the requirement.
- **Script-mode criterion**: a criterion decided by running a command, as opposed to one judged by a person or an AI.
- **Node budget**: the per-kind size cap of a baseline node, set in project settings under `budget.baseline.*`.

### Boundary notes

- Declaring which requirements a criterion covers, and citing a rule from a criterion, are the specification branch's ("Cite a baseline rule"); adding requirements is corpus's.
- Marking a requirement as migrated is done on the requirement inventory, not here; it refuses a rule that is not live. This leaf only reads the mark.
- Whether a rule is live, and what a baseline node contains, are the product-baseline branch's. The node budget is measured here because it rides the same size check (`packages/lore/src/adapters/cli/commands/status.ts:1500-1520`, read 2026-10-10; caps from `packages/core/src/config.ts`, `resolveBaselineNodeBudgets`; measure in `packages/lore/src/service/baseline-node-budget.ts`).
- Retired: BR-424 (every outline entry must link to a detail document). The outline became read-only history in slice 3a (BR-694); the outline-tier cap and the detail-link check were then removed from the code in slice 3b (`packages/lore/src/service/prd-budget-check.ts`, header "RETIRED (Baseline slice 3b, D7)"); a stored outline is neither measured nor reported.
- Known gap, read 2026-10-10: for a requirement not migrated, the code still counts only specs filed directly under the requirements document (`packages/lore/src/service/corpus-service.ts:3854`, `findMany({ parent_id: prd.id, type: "spec" })`). BR-420 states the target decided with owner decision D5 (a spec has no parent, so "filed under" no longer selects anything). The task `task-3b-consumers-tree-check-navigation-outline-stats-import`, criterion AC-BLS3B-6, makes the scan corpus-wide. Migrated requirements are already looked up corpus-wide (`corpus-service.ts:3866`).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whole body limit of a requirements document | 24,000 characters | requirements-document author (per document) | 2026-10-10 |
| Free-text field limit of a requirements document | 1,000 characters | requirements-document author | 2026-10-10 |
| Leaf node budget | 16,000 characters and 30 rules (default; not set in this repository) | project settings maintainer (`budget.baseline.leaf_chars`, `leaf_rules`) | 2026-10-10 |
| Branch node budget | 16,000 characters (default; not set in this repository) | project settings maintainer (`budget.baseline.branch_chars`) | 2026-10-10 |
| Architecture standard budget | 8,000 characters (default; not set in this repository) | project settings maintainer (`budget.baseline.standard_chars`) | 2026-10-10 |

### Depends on

- specification: criteria, the requirements they name, and the rules they cite.
- product-baseline: which rules are live, and the baseline nodes measured.
- Report corpus health: the combined exit code.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A requirements document whose requirement list cannot be read passes as having none, and a spec whose criteria cannot be read adds no coverage (BR-421). Should either fail? | unconfirmed | engineering |
| Q2 | For a requirement not migrated, criteria of archived or deprecated specs still count as coverage, while for a migrated one they do not (BR-420, BR-983). Intended? | undecided | product |
| Q3 | Closed 2026-10-10 by owner decision D5: a spec has no parent, so where a spec is filed cannot limit coverage; criteria of every spec count (BR-420). The code still lags (see Boundary notes). | answered | product (owner) |
| Q4 | A budget that cannot be read is silently treated as absent, so only the whole body is measured (BR-425). Should it be a finding instead? | unconfirmed | engineering |

#### Rules held at established

| Rule | Criterion that would fail if it were false |
|---|---|
| BR-418 | AC-055-6 (covered and uncovered listing, P0 separately). The rule no longer carries which specs count; that is BR-420. |
| BR-422 | AC-BLS3-11 (24,000-character body, exit 3 one over); also cited by AC-BLS3B-8 (two attested passes, 2026-10-10). |

#### Rules held below established

Each rule below matches the code as read on 2026-10-10 (commit 70f2785d; BR-1010 and the size rules at the slice 3b merges; BR-420's corpus-wide scope is the target the Known gap note describes), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-419 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-420 | undecided | decided by Q2 | Should finished specs stop counting? Its corpus-wide scope is decided (Q3) and asserted by AC-BLS3B-6, not yet landed. |
| BR-421 | unconfirmed | decided by Q1 | Suspected defect (silent fallback); should an unreadable requirement list or unreadable criteria be a finding? |
| BR-423 | unconfirmed | established | No question about intent. It lost its only citation in the 2026-10-09 citation audit; AC-BLS3B-8 now cites it (two attested passes), held until an independent fidelity sample confirms that citation. |
| BR-425 | unconfirmed | decided by Q4 | Suspected defect (silent fallback); should an unreadable budget be a finding? |
| BR-983 | unconfirmed | established | No question about intent. Cited by AC-BLS3-4 and AC-BLS3-10 (slice 3a); held until those criteria carry a runner-recorded pass. |
| BR-1010 | unconfirmed | established | No question about intent; decided with the slice 3b budgets (D7). Cited by AC-BLS3B-8 (two attested passes, 2026-10-10); held until an independent fidelity sample confirms that citation. |
