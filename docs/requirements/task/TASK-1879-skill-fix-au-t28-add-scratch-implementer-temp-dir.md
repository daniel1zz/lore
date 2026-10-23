---
id: TASK-1879
type: task
role: plan
title: "[Skill:fix] AU-T28 add .scratch/ (implementer temp dir) to the worktree-remove regenerable set — user-approved loosening 2026-10-19"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: USER DECISION 2026-10-19 (AskUserQuestion, answer "加入清单"): add the worktree-local `.scratch/` directory to the worktree-remove regenerable (loss-free) set. Context: the shipped lore-implementer.md now tells implementers to put temp files in the worktree's gitignored `.scratch/` (peer session, 8c53dd4a); lore done then kept such a worktree ("ignored data outside the regenerable set: .scratch/", decision record 150). Evidence content needed later is copied into evidence rows (output tails), so .scratch/ holds nothing whose loss loses evidence. This is a loosening approved by the human; record that in the code comment next to the pattern (who/when/why), like dist-npm/.
Red-first: a merged worktree whose only ignored path is .scratch/x -> today kept/escalated (red); after: removed with an auto decision. Control: an ignored .env is still kept and escalated.
Source: user decision 2026-10-19; peer report
AC: test green; AC-AU-11 oracle passes.
