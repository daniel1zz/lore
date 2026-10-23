---
id: TASK-1703
type: task
role: plan
title: "lore ac supersede reports 'requires --by <spec>:<AC-ID>' for a well-formed --by value, intermittently"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19 ~21:43, dist/lore built from main the same evening. Against spec-session-trail-a-session-local-record-of-what-each-run-4, with --by naming spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end:AC-DJ-4 (slug form) or 01M5A502BK7JX5TC0BQ9S3490C:AC-DJ-4 (id form), as '--by v' or '--by=v', with and without --json: 5 of 6 attempts printed 'Error: lore ac supersede requires --by <spec>:<AC-ID>.' (exit 2) and wrote nothing. The commands/ac.ts check is typeof args.by === 'string' plus a ':' separator, so args.by did not arrive as that string. One attempt ('ac supersede <spec> AC-ST-9 --by=<id>:AC-DJ-4 --reason x --json') did write: AC-ST-9 superseded_by {ac: AC-DJ-4, reason: 'x', at 2026-10-19T13:43:22.672Z}. The reason 'x' was a probe value that was not meant to be stored; a superseded criterion is immutable, so it cannot be corrected. resolveInvocationIdentity keeps --by in argv, so the loss happens later: citty parsing, strict-flags, or another --by consumer. Reproduce, find which layer consumes or rewrites args.by, fix it, and pin it with a test that runs both spellings through runCli. AC-ST-7 (superseded by AC-DJ-2) and AC-ST-10 (by AC-DJ-4) still await supersede.
