---
id: TASK-1488
type: task
role: plan
title: "[Skill:test] TG-2 move five live-repo-state tests into check scripts"
status: archived
priority: high
phase: "Phase 2: clear offenders"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1504, type: blocks}
  - {id: TASK-1502, type: blocks}
  - {id: TASK-1501, type: blocks}
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: Five tests check this repository's live state and belong in check scripts or pre-push, not in the unit suite: packages/lore/tests/integration/claude-md-emphasis.test.ts (:404,:413, real repo scan with isolateHome:false), claude-md-slug-pointers.test.ts (:377,:395), list-json-real-corpus-buffer.test.ts (:109-115, oracle of AC-MOS-2), phase-write-lifecycle-doc-parity.test.ts (:707,:717 live list/audit; :476 grep over REPO_ROOT; oracle of AC-PHASEVER-2(b)/3(d)), scripts/tests/spec-mirror-export.test.ts (:749 describe against the real corpus, :1142, :1256; oracle of approved AC-FR-6/7/10; keep the pure-function part :1018-1140). For each: keep a mkdtemp-fixture test of the logic, move the live-state check into a scripts/check-*.ts wired into the package.json test chain or hooks/pre-push (and assets/project/pre-push byte-identical), and rebind the AC with lore ac set --correction (original command, its result, why it corrects). First confirm each AC's verify binding with lore ac list.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-9 (part) — none of the five files reads the repo's .lore/ or scans the repo tree; each moved check runs from a check script; each rebound AC passes lore verify.
