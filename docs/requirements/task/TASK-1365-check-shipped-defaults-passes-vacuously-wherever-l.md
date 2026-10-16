---
id: TASK-1365
type: task
role: plan
title: "check-shipped-defaults passes vacuously wherever .lore/config.yaml is absent (every worktree, clone, CI)"
status: archived
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"vacuous-oracle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"635bb56b-c7f3-4bed-a87d-967d306a2ab9"}
---

scripts/check-shipped-defaults.ts treats a missing .lore/config.yaml as zero overrides and prints 'OK ... 0 violations' (exit 0). The file is gitignored (.gitignore '.lore/*'), so in every worktree, fresh clone and CI run the check measures nothing yet reports a pass; scripts/tests/check-shipped-defaults.test.ts:557 asserts that vacuous exit 0. Same commit is green in a worktree and red in the main checkout. This is how #219 slipped past its implementer.

**Expected:** The dogfood config the check guards is a versioned repo fact (tracked), and a missing config is a loud failure, never 'OK'
**Actual:** Missing config => 'OK — no .lore/config.yaml present, so 0 shipped-default drift violation(s)', exit 0

Reported by: agent:session-ee1cedaf
