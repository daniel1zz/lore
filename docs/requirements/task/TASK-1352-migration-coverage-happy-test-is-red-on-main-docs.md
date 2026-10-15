---
id: TASK-1352
type: task
role: plan
title: "migration-coverage HAPPY test is red on main: docs/requirements mirror holds duplicate frontmatter ids (SPEC-092, -095..-098 …), so already_existed is 1 not 0"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"mirror-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0c2f9c3f-efef-46c8-9115-e0252c9d327c"}
---

Measured 2026-10-15: packages/lore/tests/unit/eval/migration-coverage.test.ts 'imports all parseable files and reports passed=true' fails at line 126 (already_existed expected 0, got 1). It was already red at df34b918 (checked in a detached worktree), so it predates this session. find docs/requirements -name '*.md' shows pairs sharing one id, e.g. SPEC-092-output-contract-… and SPEC-092-strict-flag-hardening-…, SPEC-095..SPEC-098 likewise.

**Expected:** Each mirror file carries a unique human id, so a migration import of docs/requirements never sees the same id twice; the test stays green
**Actual:** Several mirror ids are shared by two different specs; the import counts one as already_existed and the test is red on main

Reported by: agent:session-66711aa8
