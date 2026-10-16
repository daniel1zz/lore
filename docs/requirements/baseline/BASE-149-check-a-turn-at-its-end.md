---
id: BASE-149
type: baseline
role: intent
title: "Check a turn at its end"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: BASE-027
---
## Check a turn at its end

> When the main session's turn ends, one review looks back over what that turn changed and either lets the turn end silently or blocks it once, listing every finding together, so the agent repairs while the change and its context are still in hand.

It replaces checks that used to fire on every single edit or at stop one by one (adr-rule-delivery-tiers-gate-hook-skill-and-optimistic, section 2: behavioural checks run once per turn at its end). Rules BR-1087 to BR-1091 landed with `spec-interception-moves-off-every-tool-call-one-turn-end-review`.

### Behaviour

**Command.** Implicit: the end of a main-session turn runs the turn-end review hook (`assets/hooks/stop-turn-review.mjs`). Nobody calls it by hand.

**Constraint.** The review compares the working tree now with the snapshot taken when the turn started, so changes left by earlier turns are never reported again. With no finding the turn ends silently (exit 0, no output); with one or more findings it blocks the turn once and lists all of them together (BR-1087). A turn that is already continuing because of an earlier block is not reviewed again; a turn whose edit record cannot be read ends normally with one line saying the turn was not measured, never a block (BR-1087). Edits made inside a helper agent carry that agent's id and never count as the main session's (BR-1088). Three kinds of finding exist:

- **Main-session source edit** (off by default; BR-1089). Only when the project or user settings turn it on: a source file the main session changed this turn, unless it is a settings or config file, lies under `hooks`, `.claude`, `.github`, `.vscode` or `.lore`, or the main session's source edits this turn total at most 3 changed lines. The finding names each file and says to hand the change to an implementer agent or get the user's explicit go-ahead.
- **Anchor drift** (BR-1090). A declared code anchor of a live spec that the working tree deleted or renamed during the turn, whether by an edit, `rm`, `mv` or `git mv`; the finding names the spec and the path. An anchor already missing at the turn-start snapshot is earlier drift for the drift check, not a turn finding.
- **CLAUDE.md over its ceiling** (BR-1091). A CLAUDE.md edited this turn that the CLAUDE.md check finds over its ceiling; the finding carries that check's report. The check runs once at turn end, not after each edit.

**Event.** None recorded: the review only reads, and writes nothing but its block or its one "not measured" line.

### Terms used here

- **Turn-start snapshot**: the record of the working tree taken when the user's prompt opens the turn (`user-prompt-turn-start.mjs`); every finding is measured against it.
- **Edit record**: the per-turn list of edits written by the post-edit hook (`post-edit-mark.mjs`), each carrying the helper agent's id when a helper made it.
- **Main session**: the session the person talks to, as opposed to the helper agents it starts.
- **Source file**: a file of a programming-language type (for example `.ts`, `.js`, `.py`); settings, config and documentation files are not source files for BR-1089.

### Boundary notes

- This leaf is filed under the session branch because it is about what happens at the end of a session's turn. The session branch's Children table and its Inside boundary do not list it yet; updating them is a change to the parent, not to this leaf.
- The hook scripts and their registration in the agent settings are distribution's ("Install the agent integration"); this leaf owns what the review decides.
- How the CLAUDE.md ceiling is set and measured belongs to the branch that owns the CLAUDE.md check (`lore status --check-claude-md`); this leaf owns only that the check runs at turn end and that its report becomes a finding (BR-1091).
- Which anchors a spec declares, and the full drift check, belong to the drift check (`lore status --check-drift`); this leaf reports only the anchors the turn itself removed (BR-1090).
- Refusals of checkpoint writes (spec creation, spec and plan approval, claiming) are made by the write itself, not by any hook (BR-1092, "Install the agent integration").

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Main-session source-edit finding | off; turned on by `workflow.turn_end.main_session_source_edits: block` (values `off`, `block`; packages/core/src/config.ts:689-691) | project settings maintainer | 2026-10-15 |
| Changed lines the main session may make to source files per turn without a finding | 3 (stop-turn-review.mjs `SOURCE_EDIT_ALLOWANCE`) | fixed in the hook | 2026-10-15 |

### Evidence

Each rule is cited by a check-decided criterion of `spec-interception-moves-off-every-tool-call-one-turn-end-review` whose test fails if the rule is false, with runner-attested passes recorded: BR-1087 by AC-TE-3 and AC-TE-7; BR-1088 by AC-TE-2; BR-1089 by AC-TE-3; BR-1090 and BR-1091 by AC-TE-4.

### Depends on

- distribution, "Install the agent integration": installs the turn-start, post-edit and turn-end hooks.
- The CLAUDE.md check and the drift check, whose reports become findings here.

### Open questions

None open.
