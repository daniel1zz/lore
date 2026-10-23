---
id: TASK-1480
type: task
role: plan
title: "[Skill:test] Live-corpus mirror checks leave the unit suite so a concurrent write cannot turn it red"
status: deprecated
priority: medium
phase: "Phase 1: red main"
created: 2026-10-16
updated: 2026-10-23
tags: []
parent: PLAN-190
plan: PLAN-190
---
Estimate: M
Approach: scripts/tests/mirror-status-parity.test.ts (AC-OX-6) and the live-corpus cases of spec-mirror-export.test.ts compare docs/requirements to the LIVE corpus, so any corpus write after the last export (another session, lore verify's own evidence rows, a new task) turns the unit suite red. Move these live-corpus consistency checks out of test:vitest into the mirror check / pre-push gate, or make them compare against a corpus snapshot taken with the export; keep the unit suite deterministic.
Source: round-0 verification 2026-10-16: test:vitest was 729/729 green on 13090beb, then 1 failed (mirror-status-parity) minutes later under lore verify after one new task doc was created.
AC:
- creating a doc in the live corpus after a mirror export does not change the exit code of bun run test:vitest; the same drift is still reported by bun run check:spec-mirror (exit 2)
