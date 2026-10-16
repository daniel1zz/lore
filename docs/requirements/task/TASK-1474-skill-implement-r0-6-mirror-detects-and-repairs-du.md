---
id: TASK-1474
type: task
role: plan
title: "[Skill:implement] R0-6 mirror detects and repairs duplicate human_ids; parity skips baseline (#210 #234 #32)"
status: draft
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: L
Resolves: task-gh-1343388703-210, task-gh-1343388703-234, task-gh-1343388703-32
Approach: (a) product: repairCollisions (packages/lore/src/service/export-docs-service.ts:1302) groups by file_path only; also detect live docs sharing a mirror human_id and repair (renumber the later doc) or fail loud; scripts/export-spec-mirror-core.ts --check exits 2 naming both docs. (b) data: run the repaired export on main's corpus so the 10 duplicate pairs (SPEC-092, 095-102, 156) are renumbered; review the whole docs/requirements diff; commit it alone. (c) scripts/tests/mirror-status-parity.test.ts enumerates baseline mappings that MIRROR_TYPES excludes: skip mappings whose type resolves to null (line ~145).
Covers: AC-R0-5, AC-R0-1
AC:
- AC-R0-5 red first, then green
- migration-coverage.test.ts, spec-mirror-export.test.ts and mirror-status-parity.test.ts pass on main; bun run check:spec-mirror exits 0
