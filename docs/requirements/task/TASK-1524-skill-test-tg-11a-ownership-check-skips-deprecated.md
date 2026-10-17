---
id: TASK-1524
type: task
role: plan
title: "[Skill:test] TG-11A ownership check skips deprecated specs; not-built ledger; mechanical oracle repoints"
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
  - {id: TASK-1519, type: blocks}
  - {id: TASK-1520, type: blocks}
  - {id: TASK-1523, type: blocks}
  - {id: TASK-1518, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: (1) Fix scripts/check-ac-oracle-ownership.ts: it scans criteria of deprecated specs (spec-governance-weight-must-scale-with-measured-blast-radius-a and spec-a-conclusion-with-no-currency-signal-and-no-falsifier are deprecated; their AC-GRADE-* / AC-CONV-* oracles never existed). Only live specs count (AC-TG-5 says "live script AC"); a skipped spec is counted and named in the output (AS-17), red-first with a deprecated fixture spec. (2) Add an explicit ledger for criteria whose oracle is not built yet, each row {spec, ac, reason, owner plan} — first rows: AC-CT-3..6, AC-CT-8..10 of spec-corpus-truthfulness-a-verdict-must-carry-the-state-it, owner = the new corpus-truthfulness completion plan; a stale row fails the check. (3) Mechanical repoints (~14): dashboard ACs AC-077-1/2/3/6, AC-PCI-14, AC-P0C-5/6/8 → packages/dashboard/tests/...; AC-062-3/5 → packages/lore/tests/unit/adapters/http/config-routes.test.ts; AC-RS-12; AC-WTC-2; every AC command running `node scripts/embed-assets-manifest.mjs` → bun; leftovers AC-080-1, AC-SI-11 (bootstrap-injection.test.ts deleted in 4b515543), AC-080-8, AC-OX-11, AC-JV-6, AC-CTX-5, AC-073-4, AC-060-7, AC-061-7. Each via lore ac set --correction with old command, result, why; verify each new command exits 0. Citation rule: if lore ac set --correction demands a cite, cite only a live rule the criterion verifies (lore rule find --text / lore rule show); if none fits, lore ac exempt with a reason naming this task. Never paste the refusal's suggested BR.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-5, AC-TG-9); split of task-skill-test-tg-11-repoint-missing-oracle-paths-merge (measured on main 755267a8: 268 findings = 80 missing-owner-file + 188 unowned-ac-reference)
AC: missing-owner-file findings outside the report-issue channel (task B) reach 0; deprecated specs are skipped and counted.
