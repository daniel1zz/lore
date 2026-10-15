---
id: TASK-1326
type: task
role: plan
title: "Malformed {{lore:...}} tokens (e.g. {{lore:Bad}}) pass through expansion silently and can ship"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"no-silent-fallback","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"651499da-4fe9-4da7-a259-6edddb1e776b"}
---

spec-lore-owned-agent-context-is-generated-from-templates-and D2 expands only the exact {{lore:[a-z][a-z0-9_]*}} form and leaves every other {{...}} byte-for-byte. A typo such as {{lore:Bad}} or {{lore:tail-chars}} therefore reaches .claude/rules and installed skills unexpanded with no error, contradicting the plan invariant I1 (no rendered file contains '{{lore:'). Found by lore assess on plan-generate-lore-owned-agent-context-from-templates-and.

**Expected:** Any '{{lore:' substring that is not a valid token is a VALIDATION_ERROR naming path:line (D3), while non-lore double braces such as {{file_list}} stay untouched
**Actual:** expandTemplate returns {{lore:Bad}} unchanged; expandFragments and RealAssetSource ship it

Reported by: agent:session-ee1cedaf
