---
id: TASK-1285
type: task
role: plan
title: "lore setup: a second --dry-run right after a real install rewrites the install manifest (one file's sha256 changes), so AC-046-E.R1 is red on main"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"setup-idempotence","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fb41a6c0-8143-44cf-8676-2b691df37ada"}
---

packages/lore/tests/integration/cli/setup.test.ts 'AC-046-E.R1: a second --dry-run right after a real install reports every file as would skip' fails at the manifest equality assertion (line ~496: expect(manifestAfter).toBe(manifestBefore)) — one entry's sha256 differs (9ab3ff86… expected vs bfd7bbb9… received). Measured red on main at 4f9973ef (before the baseline slice-1 work) and on current main, so it is pre-existing and independent of that plan. A dry run that mutates the manifest is a side effect on a read-only path; or an installed file's content is not reproducible between install and dry-run.

**Expected:** A --dry-run after a real install leaves the install manifest byte-identical and reports every file as would-skip.
**Actual:** Manifest differs in one sha256; test fails with 1 failed | 14 skipped.
**Repro command:** `bunx vitest run packages/lore/tests/integration/cli/setup.test.ts -t 'AC-046-E.R1'`

Reported by: agent:main-orchestrator
