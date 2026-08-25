---
id: TASK-836
type: task
role: plan
title: "[Skill:implement] D9's configured-repo substitution silently skips projection when the config is not GitHub-shaped"
status: draft
priority: critical
created: 2026-08-25
updated: 2026-08-25
tags: [regression, silent-fallback, defect-channel]
parent: PRD-001
---
MEASURED on main at fb29ab96 by the FULL SUITE (4 failures in packages/lore/tests/unit/service/resolution-projector.test.ts): 'expected spy to be called 1 times, but got 0 times' in AC-GI-4 scenario 3, and three failures in scenario 5.

ROOT CAUSE, read at the call site (commands/issue.ts ~line 857-874): D9's fix made the live GithubIssueRef take its repo from classifyFeedbackUpstream(config). When the config is NOT GitHub-shaped, liveRepo is undefined, githubRef becomes undefined, and the 'if (projector !== undefined && githubRef !== undefined)' guard SILENTLY SKIPS projection. A task that carries extra.issue_report.github no longer projects at all unless the current config happens to be GitHub-shaped.

⛔ That is a silent no-op on a path whose whole purpose is that the corpus verdict reaches GitHub — the exact failure class this project bans.

REQUIRED BEHAVIOUR: prefer the CONFIGURED repo (D9's intent — the stored one goes stale after a repository rename), and FALL BACK to the stored repo when the config is not GitHub-shaped. Never skip silently. The issue exists in whichever repo it was filed into, regardless of what the config says today.

⛔ Do not 'fix' this by deleting or weakening the four failing tests: they assert the pre-D9 contract (a stored ref projects), which is still correct. D9 narrowed WHICH repo string is used, never WHETHER projection happens.

⛔ Keep D9's rename regression test green — the adopt task added one that renames the repo mid-flow and asserts the label lands under the NEW name. Both properties must hold simultaneously.
