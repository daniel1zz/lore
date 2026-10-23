---
id: TASK-1717
type: task
role: plan
title: "Own-diff fixture claims inherit the ambient session id, so AC-DJ-1/AC-DJ-3 fail under lore verify's env allowlist"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19 22:48: lore verify plan-d3a-... --task task-d3a-a-... ran AC-DJ-1 and AC-DJ-3 with exit 1. AC-DJ-2 passed. The same files pass under bun run test:file in a Claude Code session. Failure: the fixture's 'lore claim' for task-u-2 / task-t1-1 is refused because the conflicting task is 'held by the SAME untraceable identity "apple" from a different worktree/machine' (SPEC-042 D10). The fixture lets every claim inherit the ambient CLAUDE_CODE_SESSION_ID; verify's env allowlist strips it, so all claims fall back to the OS user. The tests are not hermetic. Fix: every fixture claim names its own run explicitly (--harness-run cc:<fixture-session-N>, or an explicit per-claim env), and the fixture removes the ambient session variables before spawning lore. Oracle: lore verify on the plan passes AC-DJ-1..4, and so does bun run test:file with CLAUDE_CODE_SESSION_ID unset.
