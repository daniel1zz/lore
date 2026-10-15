---
id: TASK-1099
type: task
role: plan
title: "Nothing mechanically stops a test or smoke run from writing this repo's own .lore corpus; the rule exists only as CLAUDE.md prose"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"test-isolation","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6549a12b-7bc9-48e2-b41a-3e845369cc0a"}
---

Root CLAUDE.md forbids tests and smoke checks from writing the repo's live .lore corpus and points at packages/dashboard/tests/e2e/global-setup.ts (mkdtemp + lore init, assertPortFree/assertServerIsOurs) as the canonical pattern. That guard covers only the dashboard e2e global setups. No helper, test setup file, or corpus-resolution check refuses a vitest/bun test or a script that spawns 'lore' with cwd inside the repo, which resolves to the team's live corpus via corpus-resolution.ts. Found while authoring the architecture tree standards (AC-BLS3-9).

**Expected:** A test-time guard (setup file or corpus-resolution check under a test env marker) refuses any write to the repository's own .lore/lore.db from the test runners, so the rule is enforced rather than remembered.
**Actual:** Only the dashboard e2e global setups isolate; unit/integration tests and smoke scripts rely on author discipline.

Reported by: agent:arch-author
