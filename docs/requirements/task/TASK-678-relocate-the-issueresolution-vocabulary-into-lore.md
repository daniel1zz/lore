---
id: TASK-678
type: task
role: plan
title: "Relocate the IssueResolution vocabulary into @lore/core so there is genuinely one construction site and the dashboard switches themselves fail to compile"
status: archived
priority: medium
phase: "read-surfaces"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-127
plan: PLAN-127
---
AC-DC-9 went RED on the MERGED tree though it was green in its author's worktree — the exact 'a threshold armed by one agent is invalidated by a concurrent peer merge' shape. Measured on main at 1634db63 via lore verify: 'exactly one file may construct the terminal-resolution member set: expected [2 sites] to deeply equal [1]', the second being packages/dashboard/src/lib/api.ts.

⛔ The fix is NOT to narrow AC-DC-9's scan universe. That would be an AC weakened after it went red, which is indistinguishable in the audit trail from covering up a failure — and the duplicate is real, merely type-COUPLED rather than silent. Instead eliminate it: relocate the IssueResolution union + its member arrays into @lore/core (pure types/consts only — ⛔ the default barrel must never top-level-import a Node builtin, Vite's dev stub throws at module load and blanks the SPA), have packages/lore/src/service/issue-resolution.ts DERIVE from it, and have the dashboard import it so api.ts no longer constructs a list at all.

Then BOTH ACs hold unmodified: AC-DC-9's one-construction-site check passes because there is one, and AC-DC-12's coupling upgrades from a test-tree type assertion to the switches THEMSELVES failing to compile — which the dashboard implementer named as the correct upgrade it could not reach inside its own anchors.

⛔ Do not weaken terminal-resolution-ssot.test.ts's universe or its assertion; it should pass because the second site is GONE. Re-run lore verify for AC-DC-9 AND AC-DC-12 and report both.
