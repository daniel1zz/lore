---
id: TASK-911
type: task
role: plan
title: "lore evidence rejects an AC command that lore verify accepts: 'cd <dir> && bun test <relpath>' fails the oracle-file path check"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"oracle-path-resolution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6642f0fb-024b-43c4-a5c0-cb599c30b4ce"}
---

AC commands of the form 'cd packages/lore && bun test tests/integration/x.bun.test.ts 2>&1 && echo ...' run green under 'lore verify --task'. The SAME command passed to 'lore evidence <task> --oracle test --command ... --capture' is refused: 'Oracle file(s) not found: tests/integration/x.bun.test.ts. Checked root(s): <repo root>'. evidence resolves the test path against the repo root and ignores the leading cd, so a gate task cannot re-record a declared AC verbatim.

**Expected:** Both commands resolve oracle paths the same way (honour a leading 'cd <dir> &&' or resolve against the AC's execution_root).
**Actual:** verify passes, evidence refuses; measured on AC-STR-3/4/5/7 of spec-claude-md-root-section-structure-check-and-adoption-mode.

Reported by: agent:main-orchestrator
