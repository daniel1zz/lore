---
id: TASK-811
type: task
role: plan
title: "[Skill:implement] classifyFeedbackUpstream as the single shape-policy source for both issue verbs, plus the two stale issues.ts comments"
status: draft
priority: high
phase: "P2: Fix"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-140
plan: PLAN-140
---
Implement spec D1-D4. Anchors deliberately cover BOTH the capability (report-issue-wiring.ts) AND both production call sites (the two command files) — per this repo's rule that capability and wiring are ONE acceptance unit. The two stale comments in commands/issues.ts (AC-IS-5's greppable phrases) are inside these anchors and MUST be rewritten in this task, not deferred.
