---
id: TASK-859
type: task
role: plan
title: "The mirror exit-code SSOT is split across two modules, with an AC standing in for a structural non-collision guarantee"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"ssot-split","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"8e1a99fc-433b-4dde-b2fa-b5de01db4105"}
---

From handoff knowledge-handoff-agent-main-orchestrator-133, NS4, unfiled until now.

The mirror exit-code SSOT is SPLIT across two files: MIRROR_DRIFT_EXIT_CODE and its neighbour live in scripts/export-spec-mirror-core.ts, while MIRROR_USAGE_EXIT_CODE=3 lives in scripts/export-spec-mirror.ts.

The non-collision is currently mechanized rather than structural: AC-MOS-3 asserts that 3 differs from both core codes, so a future core code taking 3 turns it red. That is a real guard and it is why this is medium and not high. But the clean fix is moving all three constants to core, which makes collision impossible instead of merely detected.

**Expected:** All three mirror exit codes are declared in one module (scripts/export-spec-mirror-core.ts), so a collision is structurally impossible rather than caught after the fact by a criterion that a future author must remember to keep green.
**Actual:** Two of three mirror exit codes live in core and the third lives in the CLI entry, with an acceptance criterion standing in for the missing structural guarantee.

Reported by: agent:main-orchestrator
