---
id: BASE-043
type: baseline
role: intent
title: "Edit project settings"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-046
links:
  - {id: SPEC-017, type: supersedes}
---
## Edit project settings

> A signed-in person reads and changes the project's settings, or the machine-wide settings, from the dashboard, without editing the settings file by hand.

### Behaviour

**Command.** A signed-in person opens the dashboard's settings page and saves changed values, for the project's settings file or for the machine-wide settings file.

**Constraint.** Settings that run commands, carry secrets or pass the whole environment to checks are read-only on the page, with a note to change them in the file; a save that tries to change one of them is refused. A save is also refused when the result would be an invalid settings file or the file changed since the page read it. A refused save leaves the file unchanged (BR-988).

**Event.** An accepted save leaves the saved values in the settings file (BR-988). The save says, for each changed setting, whether it already applies or needs a restart: settings read once when the program starts (sync, which also chooses the shared store; the AI provider, its provider settings and AI HTTP settings; telemetry) are listed as needing a restart, and every other setting is listed as applying at once. A save never reports plain success without this split (BR-989).

**Which machine-wide file.** The machine-wide settings the page reads and saves are the file one lookup finds: `LORE_CONFIG_HOME/config.yaml` when that file exists; else `XDG_CONFIG_HOME/lore/config.yaml` when `XDG_CONFIG_HOME` is set and not empty; else `~/.config/lore/config.yaml`, but only when `XDG_CONFIG_HOME` is unset or empty. A set `XDG_CONFIG_HOME` with no lore file there means no machine-wide settings apply; the lookup never falls back to `~/.config`. A missing file is not an error, and the lookup itself writes nothing (BR-1012). When a file is found, a save writes to that file. When none is found, the first save creates one, and the order differs from the lookup in one way: a set `LORE_CONFIG_HOME` is used even when no file exists there yet. So the save goes to `LORE_CONFIG_HOME/config.yaml` when `LORE_CONFIG_HOME` is set, else to `XDG_CONFIG_HOME/lore/config.yaml` when `XDG_CONFIG_HOME` is set and not empty, else to `~/.config/lore/config.yaml`. After that save the lookup finds the new file, so a set `XDG_CONFIG_HOME` no longer means "no machine-wide settings" (BR-1024).

All four rules are enforced by the program's code, not by instructions to an agent: the refusal and the restart split happen in the settings service on every save, the lookup is one function every reader calls, and the save target is fixed from the lookup and the write-location function when the program builds its settings service.

### Terms used here

- **Setting**: one key of the project's or the machine's settings file.
- **Read-only setting**: a setting the dashboard shows but refuses to change (the current list is under Current values).
- **Machine-wide settings file**: the one settings file shared by every project on the machine, found by the lookup in BR-1012.
- **Needs a restart**: a setting the program reads only when it starts, so a saved change has no effect until the next start.

### Boundary notes

- Launching the dashboard and signing the browser in belong to "Launch the dashboard".
- Which requests count as signed in, and the fact that a request carrying a token can read settings but not save them, is request authentication, owned by **sync**.
- What each setting means and which command reads it belongs to the branch that owns that command; this leaf owns only reading and saving the values from the dashboard.
- BR-1012 (where the machine-wide file is) is held here because it decides which file the dashboard's machine settings read and save: the dashboard's settings service is built on exactly that lookup (packages/lore/src/app.ts:902-904). Every command reads machine settings through the same function (packages/core/src/config-node.ts:130, called from the CLI loader at loader.ts:410), so one rule covers both; what each command then does with a setting stays with that command's branch.
- The Distribution branch holds this leaf: no other branch owns the settings files as a whole, and the dashboard that edits them is launched there.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Read-only settings | AI provider command and arguments (run a command), AI HTTP headers (may carry secrets), verify's pass-the-whole-environment switch (passes the whole environment), the default editor (runs a command) | the settings file, by hand | 2026-10-10 |
| Machine-wide settings file lookup | LORE_CONFIG_HOME/config.yaml, then XDG_CONFIG_HOME/lore/config.yaml, then ~/.config/lore/config.yaml only when XDG_CONFIG_HOME is unset or empty (packages/core/src/config-node.ts:130-156); the settings service is built on the found file, else on the write location: LORE_CONFIG_HOME/config.yaml when LORE_CONFIG_HOME is set, else XDG_CONFIG_HOME/lore/config.yaml when set, else ~/.config/lore/config.yaml (config-node.ts:267-275; app.ts:902-904) | the environment variables | 2026-10-10 |
| Settings that need a restart | sync; the AI provider, its provider settings and AI HTTP settings; telemetry | fixed in the program | 2026-10-10 |

### Depends on

- Launch the dashboard: the settings page is reached only through a signed-in dashboard.
- sync: request authentication decides who may save.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | No structured criterion cites BR-988, BR-989 or BR-1024 (BR-1012 is cited by spec-cli-adapter AC-003-XDG-1, a script-mode criterion running packages/lore/tests/unit/core/global-config.test.ts, so it is established). The approved settings specs (config write layer, dashboard settings page) test the refusal and the restart split, but none of their criteria names these rules, so none of the three can be established yet. | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-11 at commit f67524d6 (file and line in the table), but no live check-decided criterion would fail if it were false. BR-1012 is not listed: it is established through AC-003-XDG-1. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

**Why these rules are unconfirmed, not observed.** The method ADR does not replace the confidence scheme; it uses the same four values as BR-623 (established, observed, undecided, unconfirmed). The parent branch (Distribution) states its choice for rules measured in code that no criterion cites yet: such a rule *may* be held at observed, and this branch's leaves keep it at unconfirmed with the measurement written in its question, which the parent names as equally valid. This leaf follows that branch choice, so BR-988, BR-989 and BR-1024 stay at unconfirmed. Unconfirmed here means "matches the code, not yet checked by a criterion", not "suspected defect": none of the three has a question about intent. None is undecided either, because the owner has not left any of them open.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-988 | unconfirmed | established | No question about intent. Measured: read-only keys `packages/core/src/config-editability.ts:125-130` (provider command and arguments, AI HTTP headers, verify's pass-the-whole-environment switch, the default editor); stale-file refusal by content hash `packages/lore/src/service/config-service.ts:321`, which the dashboard always sends (`packages/dashboard/src/api/mutations.ts:491`). Missing: a criterion that cites this rule and fails when a read-only setting can be changed or the file changes on a refused save (Q1). |
| BR-989 | unconfirmed | established | No question about intent. Measured: the restart list `packages/core/src/config-editability.ts:161-167` and the split in every save result (`config-service.ts:355`, `global-config-service.ts:280`). Missing: a criterion that cites this rule and fails when a save omits the applies-now versus needs-restart split (Q1). |
| BR-1024 | unconfirmed | established | No question about intent. Measured: the write location `packages/core/src/config-node.ts:267-275`, used when the lookup finds nothing (`packages/lore/src/app.ts:902-905`). Missing: a criterion that cites this rule and fails when a first save writes anywhere but the stated location (Q1). |
