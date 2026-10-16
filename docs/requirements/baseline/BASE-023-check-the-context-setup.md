---
id: BASE-023
type: baseline
role: intent
title: "Check the context setup"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-15
tags: []
parent: BASE-139
---
## Check the context setup

> A person, agent or pre-push hook learns whether the fragments are valid and chosen correctly, every target fits its limit, no line is repeated across fragments one session reads together, the project's rules files are in step and the assistant's language agrees with lore's.

### Behaviour

**Command.** Someone runs `fragments check`, optionally as JSON. The project status check runs the same check (BR-1066).

**Constraint.** Every target is rendered for every known helper type plus the wildcard. Any finding fails the check with exit 4, each finding on the error stream and in the JSON report (BR-1066). The findings are: an invalid fragment set, an illegal override, a target over its limit, project rules-file drift (BR-914), a duplicate line (BR-1067), an unknown selected name, a disable list written in settings instead of a selection file, a language disagreement (BR-915) or unknown language code, unreadable settings, no helper agent definitions, and a dynamic main-session fragment, which no longer has a target because the session-start target is retired. A duplicate is the same non-blank, non-heading line in two different fragments that one session reads together, compared exactly and after collapsing whitespace: a main session reads the project and user rules files, the session-start injection and the skills, and each helper type reads its own start injection (BR-1067). Since the session-start target is retired, a main session's session-start injection holds no fragments, so in practice its duplicates come from the rules files and the skills. A fresh project with only the shipped fragments passes (BR-913).

**Event.** None: a read-only check.

### Terms used here

- **Lore rules file**: branch glossary.
- **Selection file**: the disable list of the project or of the user ("Choose which fragments apply", BR-1060).

### Boundary notes

- Writing the language into the assistant's settings is distribution's (setup); this leaf only compares.
- Memory-file limits are checked by hygiene, not here.
- The project status report belongs to hygiene; this leaf owns only that the status check's context part is this same check, with the same findings (BR-1066).
- Whether the installed project rules files are outdated or hand-edited against what the program ships is the project check of distribution ("Check installation freshness", BR-1085); this leaf compares the project rules files with a fresh render of the current fragments (BR-914).

### Current values

- Helper types: one per agent definition shipped with lore (`<assets>/agents/*.md`), plus subagent:* (fragments-flow.ts:390, :426-427).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The user's lore rules files are never compared with a fresh render (BR-917). | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-917 | unconfirmed | established | Should check also verify the user's rules files? |

BR-916 (the earlier list of findings, held at unconfirmed) was retired on 2026-10-12 and replaced by BR-1066, which is established: it is cited by AC-RS-8, AC-RS-9 and AC-RS-13 of `spec-rule-store-git-tracked-fragment-selection-on-demand-skill` and, for the retired session-start target, by AC-UR-4 of `spec-one-upgrade-reminder-at-session-start-covers-the-global`.
