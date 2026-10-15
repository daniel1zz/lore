---
id: TASK-1354
type: task
role: plan
title: "setup.test AC-046-E.R1 fails on main: second 'lore setup --yes' rewrites the settings.json manifest sha"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"test-failure","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"eb3f36e1-f1f0-43e0-86a6-ed4685bc1468"}
---

packages/lore/tests/integration/cli/setup.test.ts 'AC-046-E.R1: a second --dry-run right after a real install reports every file as would skip' fails at the byte-identical manifest assertion: the settings.json entry sha256 in .lore-setup-manifest.json differs between the first install and a re-run. Observed identically on the main checkout (baseline d4db38b3) and in a worktree, so it predates the g1-g4 retirement.

**Expected:** A byte-identical re-run of lore setup leaves the manifest unchanged (I2).
**Actual:** manifestAfter !== manifestBefore; only the settings.json sha256 line differs.
**Repro command:** `bunx vitest run packages/lore/tests/integration/cli/setup.test.ts -t AC-046-E.R1`

Reported by: agent:session-66711aa8
