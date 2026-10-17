---
id: TASK-1518
type: task
role: plan
title: "[Skill:test] TG-11D4 unowned AC references: everything not in D1-D3"
status: archived
priority: high
phase: "Phase 3: guards"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: unowned-ac-reference findings (a test file references an AC id in describe/it/@spec_ref that it does not own) for: every remaining unowned-ac-reference not covered by D1-D3. Run `bun run check:ac-oracle-ownership` and take this group's findings. For each: if the file tests a different entry point than the owner, tag it `@layer <surface>` or use a spec-qualified ref `<spec-slug>#AC-ID`; if it tests the SAME entry point as the owner, it is a duplicate — merge any assertion the owner lacks into the owner and delete the copy (never lose an assertion). List each decision.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-5, AC-TG-9); split of task-skill-test-tg-11-repoint-missing-oracle-paths-merge (measured on main 755267a8: 268 findings = 80 missing-owner-file + 188 unowned-ac-reference)
AC: this group's unowned-ac-reference findings reach 0 with no assertion lost (show owner-side additions).
