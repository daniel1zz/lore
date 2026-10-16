---
id: BASE-135
type: baseline
role: intent
title: "Check installation freshness"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-15
tags: []
parent: BASE-046
links:
  - {id: SPEC-096, type: supersedes}
---
## Check installation freshness

> A person, agent or session hook learns whether the installed integration (the global one in an agent settings directory, or the project's scaffold) matches what the running program ships, without changing it.

### Behaviour

**Command.** Check an agent settings directory (`lore setup --check`), or check the project scaffold (`lore setup --project --check`).

**Constraint.** Read-only except a small check cache: the global check writes only its own cache (BR-846), the project check writes only the project's own cache (BR-1085). Each classifies every managed file as in sync, outdated, diverged, missing or orphaned and exits 0 when everything is in sync, 3 otherwise, listing the files per state. The project check covers the files the project scaffold manages: the lore rules files, the project-scope hooks and the lore entries in the project settings file (BR-1085). Combined with uninstall, preview or the overwrite-diverged option the check is refused with exit 2 before anything is read; combined with the project scaffold option it checks the project install instead of the global one (BR-849). A ledger that exists but is not valid is an error, exit 4 (BR-847). The defect channel probe decides the exit code only when the files are in sync (BR-850).

**Event.** `InstallationChecked`: a report and the check cache of the side that was checked. No corpus document or audit entry.

### Terms used here

- **Freshness check**, **install ledger**, **diverged file**: defined in the branch glossary.
- **Check cache**: the file a check leaves behind for the session-start advisory to read: `<agent settings directory>/.lore-setup-check.json` for the global check, `.lore/.lore-project-check.json` in the project for the project check.

### Boundary notes

- The defect channel probe belongs to issue-loop; this leaf owns only how its result enters the exit code (BR-850).
- The session-start advisory that reads both check caches and names the command to run is session behaviour ("Start a session", BR-1086). The earlier session-start stale notice that injected changed rule text is retired (BR-909, BR-910 on "Inject context at start").
- Writing the project scaffold is the project scaffold leaf; this leaf only checks it.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Exit code when everything is in sync | 0 | product | 2026-10-15 |
| Exit code when the defect channel tracker cannot be read (files in sync) | 1 | product | 2026-10-15 |
| Exit code when a mode combination is refused | 2 | product | 2026-10-15 |
| Exit code when stale (global or project) | 3 | product | 2026-10-15 |
| Exit code when the ledger exists but is not valid | 4 | product | 2026-10-15 |
| Exit code when the defect channel tool is missing or not logged in (files in sync) | 8 | product | 2026-10-15 |

### Depends on

- Install the agent integration: the ledger read here.
- The project scaffold leaf: the project files the project check classifies.
- issue-loop (not yet written): the defect channel probe.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A machine without the defect channel's command-line tool gets exit 8 from the check even when every file is in sync. Should the channel probe affect the exit code at all? | undecided | product |
| Q2 | Answered 2026-10-15 by `spec-one-upgrade-reminder-at-session-start-covers-the-global`: the project scaffold now has its own check (BR-1085), and `--project --check` runs it (BR-849). | answered | product |
| Q3 | Should only a genuinely absent ledger count as never installed, with any other read failure reported as an error (BR-848)? | undecided | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-848 | unconfirmed | established | Q3. |
| BR-850 | unconfirmed | established | Q1; also: should the probe read the project's own configured tracker? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-847, BR-849. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). BR-849 was reworded on 2026-10-15 (the check combines with the project option) and is now cited by AC-UR-1 of `spec-one-upgrade-reminder-at-session-start-covers-the-global`; its level has not been re-assessed against that criterion. Open question: which criterion, with a test that fails if the rule is false, should establish BR-847?
