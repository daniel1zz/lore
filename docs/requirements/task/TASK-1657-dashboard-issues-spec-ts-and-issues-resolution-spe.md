---
id: TASK-1657
type: task
role: plan
title: "Dashboard issues.spec.ts and issues-resolution.spec.ts configure the retired SQLite feedback.upstream.corpus_path, so report-issue exits 4 in every case"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"tests","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"88fb3085-5b7c-40ec-9e71-53aaffb48c74"}
---

packages/dashboard/tests/e2e/issues.spec.ts and issues-resolution.spec.ts point a consumer corpus at feedback.upstream.{corpus_path,root_prd} (configureFeedbackUpstream) and file reports with 'dist/lore report-issue'. The SQLite upstream transport was removed (spec-the-defect-channel-reaches-no-machine-but-its-own-github P4), so after the known-party fix (#317) the specs fail with: Error: Validation failed on field 'feedback.upstream': this corpus's feedback.upstream is configured with the retired SQLite shape ({root_prd, ...}) ... Reconfigure feedback.upstream.repo. Repro: cd packages/dashboard && bunx playwright test tests/e2e/issues.spec.ts tests/e2e/issues-resolution.spec.ts (5 failed, 1 passed).

**Expected:** The issues e2e specs exercise the dashboard Issues page against the current GitHub-backed report channel (or a fake of it) and pass.
**Actual:** Every report-issue in the specs exits 4 on the retired feedback.upstream shape; AC-074-1..4 and AC-ICL-9 fail.

Reported by: agent:session-a979eecd
