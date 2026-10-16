---
id: TASK-1397
type: task
role: plan
title: "export-docs repairCollisions does not detect duplicate mirror human_ids, so the mirror check cannot see them"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"mirror-identity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fe728a98-a9fa-4707-97da-b65134ae362f"}
---

Since df34b918 (2026-10-15) .lore/export-index.json maps 10 human_ids to two docs each. migration-coverage then counts a DUPLICATE_LINK (KN-042 links to both SPEC-156) as links_broken=1, failing packages/lore/tests/unit/eval/migration-coverage.test.ts and spec-mirror-export HAPPY(c) on main, while bun run check:spec-mirror reports OK. repairCollisions (export-docs-service.ts:1302) detects file_path collisions only.

**Expected:** No two live docs share a mirror human_id; the mirror check fails (exit 2) on a human_id collision and the exporter repairs or refuses it
**Actual:** 10 duplicate pairs; check:spec-mirror exit 0

Reported by: agent:session-c1ffea04
