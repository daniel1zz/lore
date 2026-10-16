---
id: TASK-1372
type: task
role: plan
title: "[Skill:implement] session trail schema, hook and core readers, writers at session start, helper start and each edit, and 14-day retention"
status: draft
priority: critical
phase: "foundation"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1379, type: blocks}
  - {id: TASK-1378, type: blocks}
  - {id: TASK-1375, type: blocks}
  - {id: TASK-1374, type: blocks}
---
Estimate: L
Approach: zod schema + pure reader + run-id parsing in packages/core/src/session-trail.ts; fs reader and stateBase() (twin of assets/hooks/lib/turn-state.mjs getStateBase) in packages/core/src/session-trail-node.ts exported from src/node.ts only (I6). Hook side: assets/hooks/lib/session-trail.mjs (writers + reader) and assets/hooks/session-trail-start.mjs (SessionStart: retention — trails idle > 14 days replaced by removed.json {removed_at, started_at copied from session.json}, markers older than 90 days removed, never the starting session, never state.db or non-directories; SessionStart also writes session.json {started_at} once, never overwriting it on compact/resume, and restoring started_at from removed.json when the session's trail was removed; SubagentStart: create helpers/<agent_id>.json with end_count 0 — the review alone writes helpers/<agent_id>.judged.json; every trail write is temp file + rename). post-edit-mark.mjs keeps writing edited-files.jsonl unchanged. Do NOT register hooks in the roster (the shipping task owns distribution-hooks.ts and the manifest); tests invoke hook files directly.
Source: spec Design > Trail layout; D10, D11, D13, D17.
AC: AC-ST-1, AC-ST-5. The parity test must go red when one schema field is renamed in either reader: record that red run as expected-fail evidence.
Integration: the reader exported from @lore/core/node is consumed by the trail CLI and handoff tasks; the hook lib by the measurement tasks.
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
