---
id: TASK-1838
type: task
role: plan
title: "[Skill:implement] An isolated helper's Write/Edit outside its worktree is refused before it happens"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Lesson → mechanism (CLOSE rule). Twice on 2026-10-18/19 an isolated lore-implementer subagent wrote files outside its own worktree with the Write tool or a shell redirect, despite the rule in assets/agents/lore-implementer.md ("temporary files go inside your own worktree under .scratch/ or a mktemp -d dir"): a `placeholder.txt` under a mis-derived `/private/tmp/claude-501/-Users/apple/...` path, and an `impl.patch` plus logs in the orchestrator's session scratchpad. The only thing that caught them was the turn-end helper-scope review, after the fact. "An agent should remember" is not enforcement.

End state: the write is refused before it happens. A shipped PreToolUse hook (assets/hooks/, alongside pre-dispatch-isolation-gate.mjs and pre-tool-harness-run.mjs; registered through the same hooks manifest/settings mechanism `lore setup` installs) refuses, for a subagent run that was dispatched with worktree isolation, a Write/Edit/NotebookEdit whose canonical target path is outside that run's worktree root, except a directory the run itself created via `mktemp -d` is not knowable to the hook — so the allowed set is exactly: the run's worktree (including its gitignored `.scratch/`) and the system temp dir subtree that `mktemp -d` produces (os.tmpdir()/tmp.* or the run-root TMPDIR when set). The refusal names the target, the worktree, and the allowed locations. Identification of "this tool call belongs to an isolated helper run and its worktree is X" reuses the run trail the turn-end review already uses (helper record with head/branch/working copy), not a guess from the cwd.

Out of scope: shell redirects inside Bash (a hook cannot parse arbitrary shell reliably; the turn-end review remains the detector for those, and the refusal message for Write/Edit points agents to the same allowed locations).

Oracle (red first, then green): a hook test under the existing hook-harness pattern (packages/lore/tests/integration/hooks/) feeding the hook a PreToolUse payload for an isolated helper run: Write to `<worktree>/.scratch/x` → allowed; Write to the orchestrator's session scratchpad → refused with exit code and message naming both paths; Write to `os.tmpdir()/tmp.ABC/x` → allowed; Edit of a file in another worktree → refused; the main (non-helper) session's writes → not affected by this hook. Record with `lore evidence <task> --oracle test --result pass --capture --command "<exact command>"`; verify from a fresh consumer install per CLAUDE.md Dogfooding (assets + manifest rebuilt).
