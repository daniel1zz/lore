---
id: TASK-1492
type: task
role: plan
title: "[Skill:test] TG-3 rewrite four live-corpus tests onto mkdtemp, retire mirror-status-parity"
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
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: Rewrite onto mkdtemp + lore init corpora: packages/lore/tests/unit/service/gate-feeding-fresh-install.test.ts:347-372 (backs up the real lore.db; approved AC-GV-5, -t both-ends), packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts:254-347 (runs the checker on REPO_ROOT; AC-BFI-6; the real-repo check already runs in hooks/pre-push), anchor-coverage-stale-exemption.test.ts:287,301 (AC-BFI-7), changed-tests-cli.bun.test.ts:103,118 (runs on the real worktree; AC-TC-2; copy the mkdtemp pattern at :241). Delete scripts/tests/mirror-status-parity.test.ts after rebinding approved AC-OX-6 to bun run check:spec-mirror plus a fixture test proving --check catches a status-only drift (scripts/export-spec-mirror-core.ts:234,282). Every AC change via lore ac set --correction.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-9 (part) — the four tests pass with no read of the repo's .lore/; mirror-status-parity.test.ts is gone and AC-OX-6 passes lore verify on its new oracle.
