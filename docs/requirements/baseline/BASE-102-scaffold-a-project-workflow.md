---
id: BASE-102
type: baseline
role: intent
title: "Scaffold a project workflow"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-046
links:
  - {id: SPEC-096, type: supersedes}
---
## Scaffold a project workflow

> A person or agent puts the governed-workflow files into the current project: the corpus if missing, git hooks, the tree-layout template, the ignore-list block, the managed section of the project instructions file, the baseline authoring skill with its node templates, and git's hooks setting. It also starts the citation gate in report mode when the project has not chosen a mode.

Scope: the project mode of the setup command. Its reversal is in "Uninstall an integration".

### Behaviour

**Command.** Scaffold the current directory (BR-1004).

**Constraint.** Confirmation is required (BR-811). Every step is attempted even when another fails (BR-830). A hook or tree-layout file the user customised is left untouched and reported (BR-832); in the project instructions file only the product's marked section is rewritten, after a backup (BR-836). The ignore-list block is added once (BR-835). A citation gate mode the project already has is never changed (BR-986).

**Event.** `ProjectScaffolded`: the files listed in BR-829 and BR-986 are in place; when the project had no citation gate mode, it now has report (BR-986). The run prints a per-step report and exits 1 only if a step failed (BR-831). A project ledger listing exactly the files written is written last (BR-834), so the authoring skill and templates are reversed by uninstall like every other scaffold file. A second run writes nothing (BR-833). After a scaffold with no failed step, the context refresh writes the project's rules files (BR-839). No corpus document or audit entry is written, except that a new corpus may be created.

### Terms used here

- **Project scaffold**, **install ledger**, **backup run**: defined in the branch glossary.
- **Baseline authoring skill**: the shipped instructions and node templates an agent uses to write baseline nodes; installed into the project's agent settings folder.
- **Citation gate mode**: whether the check that every criterion cites a rule is off, reports only, or refuses.

### Boundary notes

- The rules files and language written after the scaffold, and the memory-file adoption mode recorded in the project settings, are context's content; this leaf owns only that they are triggered and that their failure fails the run (BR-839).
- What the citation gate checks and what each mode does belongs to **specification**; this leaf owns only that setup seeds report mode when none is set (BR-986).
- What the authoring skill says belongs to the product baseline branch; this leaf owns only that it is installed and tracked in the ledger.
- The project ledger is read by the project uninstall (BR-840).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Target project | the directory the command runs in (BR-1004) | the caller | 2026-10-10 |
| Git hooks directory set | hooks | product | 2026-10-09 |
| Citation gate mode seeded when none is set | report | product | 2026-10-10 |
| Authoring skill install place | the project's agent settings folder, skills/lore-baseline | product | 2026-10-10 |

### Depends on

- Initialise a project corpus: the same corpus creation, plus recommended settings.
- Uninstall an integration: the reversal.
- context: rules files, language and adoption mode.
- specification: the citation gate whose mode is seeded.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A project that already sends git to another hooks directory (for example a hook manager) is silently switched to the product's, and uninstall does not switch it back (BR-837). Intended? | undecided | product |
| Q2 | A corrupt project ledger is treated as absent and rewritten, while a corrupt install ledger is refused (BR-838). Should the two agree? | undecided | product |
| Q3 | Run from a subdirectory, the scaffold targets that subdirectory, not the repository root (BR-1004). Intended? | undecided | product |
| Q4 | Which criteria, with tests that fail if the rule is false, establish BR-830, BR-831, BR-832 and BR-839? | unconfirmed | engineering |
| Q5 | BR-986 is cited by an approved criterion of the baseline slice 3a spec; it stays unconfirmed until that criterion's check has been recorded as passing against this rule. | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-10, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-830 | unconfirmed | established | Q4: its only citation was removed in the 2026-10-09 citation audit, when an independent judge found the citing criterion did not assert the rule's main claim or its named test would not fail if the rule were false. |
| BR-831 | unconfirmed | established | Q4: the per-step report is tested at the service level, but no criterion checks that the command exits 1 on a failed step and 0 otherwise. |
| BR-832 | unconfirmed | established | Q4: its only citation was removed in the 2026-10-09 citation audit, when an independent judge found the citing criterion did not assert the rule's main claim or its named test would not fail if the rule were false. |
| BR-837 | undecided | established | Q1: should a scaffold refuse, or leave alone, a hooks setting that points elsewhere, and should uninstall restore it? |
| BR-838 | undecided | established | Q2: the install ledger in the agent settings directory is refused when corrupt (exit 4). Should the project ledger follow the same rule? |
| BR-839 | unconfirmed | established | Q4: should the scaffold receipt report the refresh as a step of its own, so a failure there is not mistaken for a failed scaffold? |
| BR-986 | unconfirmed | established | Q5: no question about intent; it waits for its citing criterion's recorded pass. |
| BR-1004 | undecided | established | Q3: should the scaffold target the repository root instead of the current directory? |
