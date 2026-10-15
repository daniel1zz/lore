---
id: BASE-032
type: baseline
role: intent
title: "Install the agent integration"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-11
tags: []
parent: BASE-046
links:
  - {id: SPEC-096, type: supersedes}
---
## Install the agent integration

> A person or agent puts the product's integration (skills, agents, hooks, hook entries and the tool-server registration) into an AI tool's settings directory, re-converges it after an upgrade, or previews what that would do.

Scope: the global install and its preview. Scaffolding a project, uninstalling and the freshness check are other modes of the same command and are separate leaves.

### Behaviour

**Command.** Install (or preview) into an agent settings directory.

**Constraint.** Confirmation is required. The whole run is planned before the first write: a broken settings file, a corrupt ledger or an unknown language setting refuses it with exit 4 and nothing written; so do shipped assets that cannot be read (exit 1) or a malformed shipped hook-entry list (exit 4) (BR-825). Shipped files the user changed since the last install are left alone unless the caller asks to overwrite them (BR-818). Files the product no longer ships are removed even if the user changed them (BR-975, suspected defect, Q3). A write or removal failure stops the run (BR-824). A failed tool-server registration keeps all the file work and the ledger, names the manual registration command, and exits 1 (BR-826).

**Event.** `IntegrationInstalled`: files written or skipped, earlier versions backed up, files no longer shipped removed, hook entries merged, tool server registration attempted (an existing one is reported as already registered), and the ledger written last if what it records changed. A re-run with the same program when nothing changed writes no file at all, not even the ledger (BR-816). No corpus document or audit entry.

**What a shipped guard does once installed.** Among the hooks the install puts in place is a shell-command guard. Before an agent's shell command runs, it refuses with exit 2 a git command that can destroy uncommitted or unmerged work (such as git branch -D) at a command position, including a later chained segment; the same words inside a heredoc body (any delimiter form, an unterminated heredoc being data to its end) or in an argument position pass. The guard writes nothing (BR-1021).

### Terms used here

- **Integration**, **agent settings directory**, **install ledger**, **managed file**, **diverged file**, **backup run**, **shipped assets**: defined in the branch glossary.

### Boundary notes

- The confirmation rule (BR-811) and the conflicting-mode rule (BR-812) apply to every mode of the command; they are written here once.
- An install removes files the product no longer ships (BR-975) and stale hook entries (BR-823). Its removals follow the same link protection as the uninstall leaf's (BR-843).
- What the language setting means is context's; this leaf owns only that an install projects it and refuses an unknown one.
- BR-1021 is held here as a property of what the install ships. The branch sends what the governance texts say and how session-start hooks use them to context and session; the shell-command guard is neither a governance text nor a session-start hook, and no other leaf describes the shipped command guards, so its refusal is written on the leaf that puts it in place.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Target directory when none is named | the environment's agent settings directory, else the home directory's default | the caller | 2026-10-09 |
| Backup runs kept | 5 most recent | product | 2026-10-09 |

### Depends on

- Uninstall an integration: the reversal of what this leaf writes, and the link protection on removal.
- Check installation freshness: reads the ledger this leaf writes.
- context: the language projection.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The option to overwrite diverged files is refused with exit 2 together with the freshness check, but a project scaffold, a preview and an uninstall accept it and silently ignore it (BR-819). Should those modes refuse it too? | defect | engineering |
| Q2 | Several rules are proven only below the command (by service or argument-helper tests), not through the exit code or result the caller sees; they wait for a criterion that drives the command (BR-811, BR-812, BR-813, BR-820, BR-824, BR-828). | unconfirmed | engineering |
| Q3 | An install deletes a file the product no longer ships even when the user changed it, and keeps no backup (BR-975). Should it be kept and reported like a diverged file, or backed up first? Filed as issue 115 (open). | defect | engineering, product |
| Q4 | A missing assets folder fails the run with exit 1 (BR-825). Should the message say how to repair the installation of the program itself? | undecided | product |
| Q5 | Which criterion, with a test that fails if the rule is false, should establish BR-814, BR-815, BR-816, BR-821, BR-826, BR-975 and BR-1021 (for BR-1021, only the writes-nothing clause is unasserted)? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-811 | unconfirmed | established | No question about intent: the missing criterion: no live script-mode criterion drives the prompt or the exit 2 refusal. |
| BR-812 | unconfirmed | established | No question about intent: the missing criterion: the conflicts are unit-tested in the argument helper but no criterion drives the command's exit code. |
| BR-813 | unconfirmed | established | No question about intent: the missing criterion: the order is unit-tested in the argument helper, which no criterion names. |
| BR-819 | unconfirmed | established, or rewritten if the other modes are made to refuse the option | Q1. |
| BR-820 | unconfirmed | established | No question about intent: the missing criterion: the service test proves nothing is written but no criterion checks exit 4. |
| BR-824 | unconfirmed | established | No question about intent: the missing criterion: the service fault-injection test proves the stop and the convergence, but no criterion checks exit 1. |
| BR-825 | unconfirmed | established | Q4. |
| BR-828 | unconfirmed | established | No question about intent: exactness: the criterion checks a non-zero exit and that no language is written, not exit 4 or that no other file is written. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-814, BR-821, BR-826. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: Q5.


**BR-815 held at unconfirmed after the post-remediation fidelity sample (2026-10-09):** its only citation was judged unfaithful (seed 20261010 sample). Open question: Q5.


**BR-816 held at unconfirmed after the post-remediation fidelity sample (2026-10-09):** its only citation was judged unfaithful (seed 20261010 sample). Open question: Q5.

**BR-1021 added (2026-10-10) and held at unconfirmed:** it matches the shipped guard read at commit 5e025ad2 (`pre-bash-git-safety-gate.mjs`, which only reads its input and exits 0 or 2). It is cited by AC-066-1 to AC-066-5 of an approved spec (`spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c`), whose tests assert the exit 2 refusals and the heredoc and argument-position passes, but no test fails if the guard wrote something, and their recorded runs carry no commit, so the computed state is unknown. It was first added at observed; that level is not used in this branch, and the owner's intent is already decided by SPEC-066, so unconfirmed is the honest level. Would be: established once a citing criterion also asserts that the guard writes nothing and records a run with its commit. Open question: Q5.

**BR-975 added at unconfirmed (2026-10-10):** it states the removal the install already performs; no criterion cites it, and it describes a suspected defect (Q3).

**BR-822 and BR-816 reworded (2026-10-10):** BR-822 now says what the ledger carries after any successful install, which no longer contradicts BR-816's no-change re-run that leaves the ledger file untouched. BR-822 stays established; its citing criterion checks what the ledger carries.
