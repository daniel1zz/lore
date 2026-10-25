---
id: TASK-1656
type: task
role: plan
title: "Dashboard e2e browse-ux.pw.ts seeds a spec with parent_id, which the create gate now refuses with 422 VALIDATION_ERROR"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"tests","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"27d9c482-1bbf-4472-995a-7465d99d522c"}
---

packages/dashboard/tests/e2e/browse-ux.pw.ts createDoc POSTs /api/dashboard/docs with parent_id for a spec in the PRD -> spec -> plan -> task seed. The server answers 422 {"error":{"code":"VALIDATION_ERROR","field":"parent_id","message":"a spec takes no parent: it belongs to the product trees through its criteria's citations of business and architecture rules..."}}, so the seed test fails and the rest of the file does not run. Repro: cd packages/dashboard && bunx playwright test tests/e2e/browse-ux.pw.ts. Found while fixing #317 (known-party writes); separate root cause. Also red in the same default run, cause not yet isolated: read-flow.pw.ts AC-1 (root PRD row not visible in tree), review-loop.pw.ts home test (child create returns non-ok), write-flow.pw.ts approve (no 'Document approved' toast).

**Expected:** The e2e seed creates docs the current create gates accept, and the files pass.
**Actual:** browse-ux seed fails with 422 on parent_id; read-flow, review-loop and write-flow approve tests also fail in the default config.

Reported by: agent:session-a979eecd
