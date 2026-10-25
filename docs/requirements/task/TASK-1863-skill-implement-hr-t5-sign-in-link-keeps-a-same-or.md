---
id: TASK-1863
type: task
role: plan
title: "[Skill:implement] HR-T5 sign-in link keeps a same-origin deep-link target"
status: archived
priority: medium
phase: "record-and-read"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-237
plan: PLAN-237
---
Estimate: S
Approach: /auth/bootstrap accepts `next`; after setting the session cookie redirect 302 to it only when it is a same-origin path (starts with a single '/', no '//' prefix, no backslash, no scheme); else '/'. Update BR-862's wording via the baseline rule after landing is the main agent's job.
Source: spec-human-review-surface-decisions-audit-items-and-pending D6.
AC: AC-HR-7.
