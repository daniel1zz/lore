---
id: TASK-1010
type: task
role: plan
title: "A deprecated baseline rule cannot name its replacement: lore rule set --lifecycle deprecated refuses --note"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"addressability","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"dd90e398-7ccd-45f8-bc34-47d4a0c351ac"}
---

lore rule set BR-1033 --lifecycle deprecated --note '<superseded by BR-1055 ...>' fails with 'note is the retirement note and is valid only with lifecycle=retired'. A rule can be deprecated (still live, going away) but cannot carry a pointer to the rule that replaces it, so a reader of BR-1033, BR-1018 or BR-1022 (deprecated 2026-10-11 for spec-run-only-write-identity-and-run-end-claim-release) cannot find BR-1055 from the rule itself. The pointer exists only in the spec and ADR prose.

**Expected:** Deprecating a rule accepts (or requires) a successor rule id or note, shown by lore rule show, so the deprecated rule is addressable to its replacement
**Actual:** The note option is refused for lifecycle deprecated, and lore rule show on a deprecated rule shows no successor
**Repro command:** `lore rule set BR-1033 --lifecycle deprecated --note x`

Reported by: agent:session-e25636da
