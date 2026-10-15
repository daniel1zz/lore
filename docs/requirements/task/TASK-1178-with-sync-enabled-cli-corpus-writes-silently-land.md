---
id: TASK-1178
type: task
role: plan
title: "With sync.enabled, CLI corpus writes silently land only in the local store: the loader strips the sync section"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"no-silent-fallback","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d41b34c2-1a7c-4a2c-a4ba-9abce26a1c23"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** Per root CLAUDE.md D-007 ('no silent fallback; offline writes must not land only-local'), a CLI write in a sync-enabled project either goes through the synced store or fails loudly
**Actual:** packages/lore/src/adapters/cli/loader.ts:399-405 strips rawConfig.sync ('Corpus-level commands never need TursoStore'), so with sync enabled and no token a create/set succeeds locally with no notice

Reported by: agent:main-orchestrator
