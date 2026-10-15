---
id: BASE-047
type: baseline
role: intent
title: "Upgrade the corpus in place"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
---
## Upgrade the corpus in place

> A maintainer brings stored documents to the product's current shape.

Scope: the in-place actions of the migrate command: numbers, phases, spec kind, tasks to phases, outline and spec parents (BR-798). The phase and outline upgrades change execution's and product-baseline's documents; their specific rules are theirs. This leaf holds what the actions share, the numbering upgrade, which serves every numbered document's address, and the spec-parents upgrade with its revert, which moves every existing spec to the no-parent contract (specification, BR-1, BR-2). The spec-parents upgrade is held here rather than on "Create a spec" because it is a one-time repair of stored documents with its own preview, apply and revert, not a condition on creating or approving a spec.

### Behaviour

**Command.** A maintainer runs one named upgrade, as a preview or for real; the spec-parents upgrade can also be reverted.

**Constraint.** Only named upgrades exist; any other name ends with exit code 2 listing the supported ones (BR-798). The numbering and spec-parents upgrades only preview unless told to apply; the others write unless told to preview (BR-801).

- **Numbering.** Every spec and decision record gets a permanent number, numbers written into titles are stripped and the export index is brought in line; a preview writes nothing, applying converges and a second apply finds nothing to do (BR-799). A malformed export index is refused with exit code 4, one that cannot be read or written ends with exit code 1, and a document that could not be renumbered is listed with exit code 4 (BR-800).
- **Spec parents.** A preview lists every spec that still has a parent and writes nothing; applying clears each parent, a second run changes nothing, and revert files each spec back under the parent its audit entry names (BR-1009).

**Event.** `CorpusUpgraded`. Each changed document normally gets a version entry and an audit entry. The spec-parents upgrade is the exception: it writes one audit entry per spec naming the old parent, with no version entry and no status change, so an approved spec stays approved (BR-1009).

### Boundary notes

- That a spec has no parent, and the refusal of new parents, belong to specification, leaf "Create a spec" (BR-1, BR-2). This leaf only brings stored specs to that contract.

### Depends on

- specification, "Create a spec": BR-1, BR-2.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The numbering and spec-parents upgrades preview by default, while the phases, spec kind, tasks to phases and outline upgrades write by default (BR-801). Should every upgrade preview by default? | undecided | product |

#### Rules held below established

BR-798, BR-800 and BR-801 match the code as read on 2026-10-09 and re-read on 2026-10-10 at commit 5e025ad2 (`migrate.ts`; the one change since a248efe0 added the spec-parents action, now listed in BR-798's example). For each, no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms the code reading: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-798 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-800 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-801 | undecided | undecided | Q1. |

BR-799 and BR-1009 are held at established. BR-1009 was raised from undecided on 2026-10-10: its intent was decided by the owner in slice 3b (`spec-baseline-slice-3b-specs-belong-to-the-trees-through`), and AC-BLS3B-7, a check-decided criterion citing it, runs `migrate-spec-parents.bun.test.ts`, which fails if the preview writes anything, if apply misses a spec, writes a version entry or changes a status, if a second apply writes anything, or if revert does not restore every parent.
