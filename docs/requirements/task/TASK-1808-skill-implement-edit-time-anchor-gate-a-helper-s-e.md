---
id: TASK-1808
type: task
role: plan
title: "[Skill:implement] Edit-time anchor gate: a helper's edit outside its anchors is declared (overlap-checked) or denied before it happens"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: M
Problem: a helper's edits outside its task's declared file anchors are found only by the turn-end review, after the work; the orchestrator then adds the anchors afterwards (about 10 times on 2026-10-19: DCL-1 10 test files, DCL-4 9 files incl. package.json). While the helper worked, the anchor-overlap gate never saw those files, so a concurrent task could edit the same file. The shipped rule in assets/agents/lore-implementer.md:72 ("touch only anchors, else BLOCKED") is unenforced, contradicts practice, and relies on the agent remembering.
Decision (user, 2026-10-19): enforce at edit time in a PreToolUse hook.
End state:
- A shipped PreToolUse hook on Write | Edit | NotebookEdit, active for helper (subagent) runs. It resolves the run's open claim(s) whose recorded worktree contains the target path.
  - Path inside the claim's anchors (file or directory anchor) -> allow.
  - Path the working copy's git ignores (git check-ignore in that working copy) -> allow.
  - Otherwise the hook calls one lore command (e.g. `lore anchor declare <task> <path>`): it runs the SAME anchor-overlap predicate the task-claim gate uses against every other live claim; free -> the path is added to the task's anchors through the normal corpus write route (one version, audited to the helper's run) and the edit is allowed; held by another live claim -> exit 4, the hook denies the edit naming that claim and task.
  - No open claim in that worktree -> deny naming `lore claim`.
  - A probe that cannot decide (lore unavailable, unreadable claim) -> deny with the reason (fail-closed), never allow silently.
- Bash file writes are not interceptable by this hook; the turn-end review remains the backstop for them, and lore-implementer.md says to edit files only with Write/Edit.
- lore-implementer.md:72 is rewritten to describe this (asset + manifest regenerated).
AC: integration test with a throwaway repo, two linked worktrees and two claims: (a) an edit inside anchors is allowed with no write; (b) an edit to a free out-of-anchor path is allowed and the path is now an anchor of the task (one version row, actor = the helper run); (c) an edit to a path anchored by the other live claim is denied with exit/decision naming that claim, and nothing is written; (d) a gitignored path is allowed with no write; (e) no claim -> denied naming lore claim; (f) lore unavailable -> denied. Made red once by allowing (c). Runner-produced red (--capture).
