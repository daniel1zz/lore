---
id: TASK-1900
type: task
role: plan
title: "[Skill:investigate] AU-T25 turn-end review charges helpers with writes to a mis-encoded Claude tmp path (.../-Users-apple/Projects/.../placeholder) and re-reports a judged helper every turn"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1889, type: blocks}
---
Estimate: S
Approach: Two sessions' turn-end reviews report "helper <id> changed files outside its working copy: /private/tmp/claude-501/-Users-apple/Projects/zz/lore/placeholder" (this session, agent a3228ca78b139e7e6) and ".../-Users/apple-Projects-zz-lore/placeholder" (peer session d974cd6d, helper af9351016f7a3a648, reported every turn although its judged_end_count == end_count == 2). Measured 2026-10-19: the paths come verbatim from edited-files.jsonl edit records (the PostToolUse recorder, assets/hooks/lib/session-trail.mjs), and the directory /private/tmp/claude-501/-Users-apple/Projects exists with projects-placeholder.txt — so some write really happened at a mis-encoded Claude-Code tmp path; whether it was the agent (e.g. a test or script deriving the project tmp dir by a wrong "/"->"-" encoding) or the harness itself is unknown. Find: (1) the writer of these placeholder paths (grep the repo for "placeholder" path construction / tmp-dir encoding of the project path; check whether a lore test or script encodes the project dir; check the recorder for which tool events it records); (2) why the peer's helper is re-reported every turn despite judged_end_count == end_count (read snapshotUnjudgedHelpers / markJudged in assets/hooks/lib/session-trail.mjs and helper-scope-review). Fix each at its root: a repo writer that mis-encodes the path is fixed; a non-agent (harness) write is not charged to the helper; re-reporting of a judged helper stops. No path allowlist.
Red-first per root cause.
Source: peer session report + trail data 2026-10-19
AC: per root cause a red-first test green; a re-run of lore session trail-review on a fixture with a judged helper reports nothing.
