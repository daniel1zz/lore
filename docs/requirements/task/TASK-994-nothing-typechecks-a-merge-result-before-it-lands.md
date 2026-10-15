---
id: TASK-994
type: task
role: plan
title: "Nothing typechecks a merge result before it lands, so two individually green branches can break main's build"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"concurrency","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c3423ac2-9fc9-488f-b758-32dff0ccafd4"}
---

2026-10-12: merging task-remove-by-from-write-commands-and-mcp-write-tools-shipped (which deleted resolveActorAlias) onto a main that had just gained reopen.ts from a concurrent session (9c7cb11c, importing resolveActorAlias) produced a textually clean merge whose bun run build failed (TS2724) and broke main for every concurrent session until 9ff67b35. Each branch's own oracles were green. pre-push runs no typecheck, and the orchestrator protocol merges with --no-ff and verifies afterwards.

**Expected:** The merge step refuses (or the protocol requires a check before committing) when bun run typecheck fails on the merged tree
**Actual:** A textually clean merge lands and main stays broken until someone notices

Reported by: agent:session-e25636da
