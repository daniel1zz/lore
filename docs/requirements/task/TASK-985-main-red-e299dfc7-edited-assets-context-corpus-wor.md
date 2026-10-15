---
id: TASK-985
type: task
role: plan
title: "main red: e299dfc7 edited assets/context/corpus-workflow-2-produce.md without updating the assets-ssot sha256 pin"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"main-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"22b48448-ebf0-4fbe-85cf-264232a78558"}
---

Commit e299dfc7 (task-ac-set-correction-audited-fix-of-one-criterion-on-a-locked, merged in e84d372d) changed assets/context/corpus-workflow-2-produce.md. packages/lore/tests/unit/assets-ssot.test.ts 'context/corpus-workflow-2-produce.md body is verbatim' still pins sha256 a1ee4ce6..., the file now hashes d2aec41b.... Full vitest on main gained this 1 failure beyond the 15-failure baseline right after that merge. The pin was last updated in f9ef3cf9.

**Expected:** An asset edit updates its pin in the same commit (or the pin test points at the generated manifest)
**Actual:** assets-ssot BOUNDARY fails on main: expected a1ee4ce6..., received d2aec41b...
**Repro command:** `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts`

Reported by: agent:session-e25636da
