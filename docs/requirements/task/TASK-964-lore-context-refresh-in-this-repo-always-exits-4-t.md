---
id: TASK-964
type: task
role: plan
title: "lore context refresh in this repo always exits 4: the spliced CLAUDE.md candidate is 738 lines / 61 KB against a 220-line / 24 KB ceiling"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"context-refresh","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0fa22d50-833d-4708-b021-3445545b740b"}
---

Measured 2026-10-12 with both the current binary and the pre-task-rs-t10 binary (HEAD^1 of the T10 merge): 'lore context refresh' (project scope) exits 4 with 'refusing to write CLAUDE.md — the spliced candidate breaches its ceiling: [max_lines] 738 > 220; [max_bytes] 61387 > 24576'. The live CLAUDE.md is about 180 lines, so the splice itself inflates it roughly fourfold. Rules files are still written (D16), so the failure is masked as 'none changed' plus exit 4 on every refresh, and any automation that treats refresh's exit code as success is broken here.

**Expected:** Refresh's splice of the managed CLAUDE.md section stays within the ceiling for a CLAUDE.md that is itself within the ceiling, and refresh exits 0 when nothing needs to change
**Actual:** Every project-scope refresh exits 4 with a 738-line candidate
**Repro command:** `lore context refresh; echo $?`

Reported by: agent:session-e25636da
