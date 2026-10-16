---
id: TASK-1374
type: task
role: plan
title: "[Skill:implement] ship the trail hooks: roster registration, regenerated manifest, this repo's settings"
status: draft
priority: high
phase: "landing"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1373, type: blocks}
---
Estimate: S
Approach: packages/core/src/distribution-hooks.ts registers session-trail-start.mjs on SessionStart and SubagentStart and subagent-trail.mjs on SubagentStop (timeout 10); the UserPromptSubmit, PostToolUse and Stop entries already exist. Regenerate packages/lore/src/generated/assets-manifest.ts; update this repo's .claude/settings.json the way lore setup would. Fail-open matrix test for every new hook.
Source: spec Scope IN; D13.
AC: AC-ST-12.
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
