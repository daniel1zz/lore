---
id: BASE-048
type: baseline
role: intent
title: "Import spec files"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-018, type: supersedes}
---
## Import spec files

> A maintainer creates in the corpus the specs that exist only as files on disk.

### Behaviour

**Command.** A maintainer imports a folder of spec files: the Markdown files of one folder, without subfolders, by default docs/requirements/spec (BR-789).

**Constraint.** A file whose title is not yet a spec is created as a spec with no parent (BR-789, which follows BR-2; BR-1 is the specification branch's statement of the same contract). A file whose title is already a spec is never written into the corpus; it is reported as clean when its body matches and as drift otherwise, with the command that would copy it by hand (BR-790). A file with no valid header, not marked as a spec, without a title, or whose creation is refused is listed as an error and skipped while the others are still imported (BR-791). A folder that does not exist or cannot be read is treated as empty (BR-792, suspected defect). A dry run reports what would be created and which files are clean or drifted, and writes nothing (BR-793).

**Event.** `DocCreated` for each new spec. The import ends with exit code 0 when nothing failed (BR-789) and with exit code 4 when any error was listed (BR-791).

### Boundary notes

- Each created spec passes the creation rules of "Create a document" (corpus) and "Create a spec" (specification), including its admission check; a refusal there is one of BR-791's errors.
- That a spec has no parent (BR-1, BR-2) is the specification branch's rule; this leaf records only that import follows it.
- Only specs are imported; other types are reported as errors.

### Code not yet at the rules

BR-789's "with no parent" is the owner's decided contract (slice 3b, `spec-baseline-slice-3b-specs-belong-to-the-trees-through`, criterion AC-BLS3B-5, which cites it). The code read on 2026-10-10 at commit 5e025ad2 does not do it yet: `sync-docs-service.ts` still files each new spec under the only requirements document, or under the one named by the file's `parent` header field when there are several, and lists a file as an error when no requirements document exists or none matches. Plan `plan-baseline-slice-3b` carries the change (task `task-3b-consumers-tree-check-navigation-outline-stats-import`, blocked on the contract task). Until it lands, AC-BLS3B-5 fails on this clause.

BR-789 is live with enforcement guaranteed although the code lags because the baseline method this tree follows (`adr-the-product-is-a-baseline-tree-specs-are-implementations`, reference method "business-baseline") writes the decided rule into the tree first and has the code implemented against it, the change set (here the slice 3b spec) holding the scope and the exit condition. Lifecycle says the rule is part of the product's intended current form; whether the code meets it is what confidence and the computed verification state report. BR-791 was narrowed on 2026-10-10 to match: with no parent to decide, "a parent that cannot be decided" is no longer an error case of the contract.

### Current values

None.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A folder that does not exist or cannot be read is treated as empty (BR-792; reported in issue #100). Should it be refused? | undecided | engineering |
| Q2 | Matching is by exact title (BR-789, BR-790). Should it match by number or name instead? Until this is decided, both rules describe title matching as the code does it. | undecided | product |

#### Rules held below established

BR-790, BR-792 and BR-793 match the code as read on 2026-10-09 and re-read on 2026-10-10 at commit 5e025ad2 (`sync-docs-service.ts` is unchanged since its SPEC-021 commit). BR-789's folder, title matching and exit code, and all four of BR-791's error cases (including a refused creation, listed as 'create failed'), match the same reading. BR-789's "no parent" is ahead of the code (see above); while it lags, the code also lists a file as an error when no requirements document exists or none matches, a case the contract drops. For each, no live check-decided criterion yet passes that would fail if the rule were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms it: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-789 | unconfirmed | undecided | Q2 (title matching). The no-parent clause is decided; it waits for the code change and for AC-BLS3B-5 to pass. |
| BR-790 | unconfirmed | undecided | Q2 (title matching). |
| BR-791 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-792 | unconfirmed | undecided | Q1. |
| BR-793 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
