---
id: TASK-1375
type: task
role: plan
title: "[Skill:implement] the handoff lists every file of the caller's session trail with its change source, and says not measured without a trail"
status: draft
priority: high
phase: "consumers"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1373, type: blocks}
---
Estimate: M
Approach: lore handoff (handoff-input.ts assembleHandoffInput and the --json-file path; session-service.ts writeHandoff): resolve the caller's session from the attested run, read the whole trail via @lore/core/node; modified_files keeps exactly what the author typed; new extra field changed_files [{path, sources[], named_by_author}] + changed_files_measured is the merged view and the only list the renderer shows (D16), one entry per path; removed and unmeasured turns rendered as such; 'changed files: not measured' when no trail. Update the handoff schema in packages/core/src/session.ts and its renderer. MCP lore_handoff gets the same through the service.
Source: spec Consumers (Handoff); D16.
AC: AC-ST-11.
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
