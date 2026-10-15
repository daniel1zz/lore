---
id: TASK-1329
type: task
role: plan
title: "[Skill:test] Install-time asset expansion, manifest parity and literal lint — RED scenarios"
status: archived
priority: medium
phase: "Phase 2: Shipped assets and literal lint"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
---
Estimate: M
Source: spec AC-CV-4, AC-CV-5, AC-CV-6, D6, D8
TDD-Role: red | Paired-Impl: T3, T4
Covers: AC-CV-4, AC-CV-5, AC-CV-6

Scenarios:
- Spawn `bun packages/lore/src/index.ts setup` with HOME=<mkdtemp>: an installed skill whose source has {{lore:capture_tail_chars}} contains String(CAPTURE_TAIL_CHARS), no "{{lore:"; then `setup --check --json` → 0 outdated / diverged / missing.
- Every manifest entry of kind skill|agent|hook: sha256 == sha256(RealAssetSource.load() bytes); ≥1 entry's loaded bytes contain String(CAPTURE_TAIL_CHARS).
- Temp assets tree with an installed-kind asset naming an invocation var → embed script exits 1 naming file + var. assets/context and assets/governance hashed unexpanded. `--check` exit 0 on repo tree.
- Literal lint over the AC-CV-6 scan set: zero hits; scanned count > 0; a planted literal in a temp copy is reported with file:line + variable.

AC:
- packages/lore/tests/unit/setup/asset-install-variables.test.ts, packages/lore/tests/unit/build/asset-variables.test.ts, packages/lore/tests/unit/assets/registered-literal-lint.test.ts written; RED for missing implementation; expected-fail evidence recorded at red time.
