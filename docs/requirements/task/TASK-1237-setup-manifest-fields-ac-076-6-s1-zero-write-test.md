---
id: TASK-1237
type: task
role: plan
title: "setup-manifest-fields AC-076-6.S1 zero-write test fails deterministically on main"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"test-failure","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"72ffb31e-a71f-47fc-a9aa-17fa95c30777"}
---

Found while verifying an unrelated assets/skills markdown change. The STATE test 'two consecutive no-op converges — the second fires zero underlying file writes' fails every run, including on a clean detached worktree at 72c3ee14 with no local changes, so it is pre-existing.

**Expected:** Second no-op 'lore setup --claude-dir <dir> --yes --json' leaves the install manifest's mtime unchanged (packages/lore/tests/integration/setup-manifest-fields.bun.test.ts:261 passes)
**Actual:** Fails 3/3 runs: manifest mtimeMs changes between the two runs (expected 1791438176112, received 1791438176241), i.e. the second converge rewrites the manifest file

Reported by: agent:main-orchestrator
