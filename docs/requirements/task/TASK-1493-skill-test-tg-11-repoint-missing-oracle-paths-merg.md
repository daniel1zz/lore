---
id: TASK-1493
type: task
role: plan
title: "[Skill:test] TG-11 repoint missing oracle paths, merge duplicate AC tests, wire ownership check"
status: draft
priority: medium
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: Run check:ac-oracle-ownership on main. Repoint every missing oracle path (46 of 684 on 2fc7661e, including AC-080-1 → its replacement of packages/core/tests/unit/bootstrap-injection.test.ts deleted in 4b515543, AC-046-C, AC-060-8, AC-062-10, AC-073-4, AC-RC-14) via lore ac set --correction after finding where the behaviour is now tested; if nothing tests it, write the test. Merge true duplicates: AC-AI-11 (keep unit/ai/registry.test.ts, drop registry-http.test.ts:204-228), AC-AI-5/6/7 (keep cli-create-ai.bun.test.ts; ai-stub-binary.bun.test.ts keeps only AC-AI-1/AC-AI-20 smoke), AC-ACODE-3 (keep integration/cli/task-workflow.test.ts:456), AC-ROI-1 (keep write-commands-take-no-by.test.ts), the rest the checker reports. Then wire check:ac-oracle-ownership into the package.json test chain, and write scripts/tests/test-cleanup-exit.test.ts, the AC-TG-9 oracle over the whole cleanup (it runs after T2, T3, T6, T7, T8 and T12 have merged).
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-9 (part) — check:ac-oracle-ownership exits 0 on main and runs in the test chain.
Measured by the T9 checker on main b0d111e3 (bun scripts/check-ac-oracle-ownership.ts, exit 1): 1245 script ACs scanned, 1020 test files; 300 missing-owner-file findings covering 203 distinct missing paths (the owning file is the FIRST test file of each command, a wider count than the 46 AC-named paths measured earlier); 353 unowned-ac-reference findings, many of them legitimate cross-file references to qualify (<spec-slug>#AC-ID) or tag (@layer <surface>); 0 ambiguous-ac-id; 161 script ACs name no test file and are not checked. If triage shows the scope exceeds one task, split it with lore replan before starting.
