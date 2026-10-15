---
id: BASE-025
type: baseline
role: intent
title: "Install the lore rules files"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-139
---
## Install the lore rules files

> A person or agent gets one rules file per static main-session fragment into the project's (or the user's) rules folder, kept in step with the fragments, without losing anyone's own files.

### Behaviour

**Command.** Someone refreshes (`context refresh`, project or user scope). With the user scope only the user's own rules folder is written, from the user's fragments, and no memory file or project rules file changes (BR-894); where the user's fragments are read from is held as a suspected defect (BR-895, Q2).

**Constraint.** The fragment set must be valid and free of illegal overrides; each file must fit the rules-file limits and have a usable name (BR-896, BR-897, BR-898). A hand-edited file is kept while its fragment is still chosen (BR-891); once its fragment is no longer chosen it is deleted like any other (BR-893, a suspected defect, Q1). Only lore rules files, whose names carry the lore prefix and the markdown extension, are ever touched; every other file in the rules folder, including one with the lore prefix and another extension, is never read, changed or deleted (BR-892, BR-974).

**Event.** `RulesFilesInstalled` (per file: created BR-890, updated or unchanged BR-973, skipped BR-891, pruned BR-892; files on disk only).

### Terms used here

- **Lore rules file**, **static fragment**, **fragment place**, **fingerprint**: branch glossary.

### Boundary notes

- Which fragments are chosen for each scope is the selection leaf.
- When the memory file's own write is refused by its limits or required sections, refresh still creates, updates and prunes the lore rules files, lists them, and then fails with exit 4; the memory file is left unchanged. That case is stated by the refresh leaf ("Refresh the managed part", BR-887). The refusals in this leaf (BR-896, BR-897, BR-898) are the ones that write nothing at all.
- The rules-only refresh that project setup runs is distribution's.
- The rules-file limits are hygiene's (rules role of the memory-file limits).

### Current values

- Project rules folder: <project>/.claude/rules; user rules folder: <home>/.claude/rules (context-flow.ts:387-393).
- User fragments are read from $XDG_CONFIG_HOME/lore/context, else ~/.config/lore/context (context.ts:385, context-flow.ts:434).
- Rules-file limits by default: 100 lines, 8192 bytes (core config.ts:2180).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A hand-edited lore rules file is deleted as soon as its fragment is no longer chosen (BR-893). | unconfirmed | engineering |
| Q2 | With the lore settings folder moved, user-scope refresh reads the wrong place (BR-895). | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-893 | unconfirmed | established | Q1: should a hand-edited file be kept (and reported) when its fragment goes away? |
| BR-895 | unconfirmed | established | Q2: should all verbs read the user's fragments from the same place? |
| BR-896 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-897 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. Partly pinned: AC-CF-3 of `spec-context-fragments-config-driven-layered-rule-injection` — render.test.ts 'refuses an id that cannot be a file-name stem' pins the refusal, not the command outcome. |
| BR-898 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-973 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-974 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
