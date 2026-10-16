---
id: TASK-1394
type: task
role: plan
title: "lore create task --ac-scope stores an id the governing spec does not declare (e.g. 'AC-CRIT-1 AC-CRIT-2' as one id) without refusal"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"ac-scope-validation","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c38e4639-c54a-4222-8957-ad3d3a492035"}
---

The task-create gate lists the spec's declared script-mode criteria in its AC_SCOPE_REQUIRED denial, but once ac-scope values are given it does not check each one against that list. A shell that passed two ids as one argument (zsh does not word-split an unquoted parameter expansion) stored the single id 'AC-CRIT-1 AC-CRIT-2' on four tasks of plan-close-the-eight-verified-critical-defects; lore scope list shows it. Every downstream floor keyed on ac_scope (lore done, lore verify coverage) then matches no criterion, silently. Found 2026-10-16 by an independent plan review, not by any gate. Second, smaller defect: report-issue parses a field value that begins with '--' as an option.

**Expected:** lore create task and lore scope add refuse with exit 4 any ac-scope id that is not a criterion declared on the task's spec-tier ancestor, naming the unknown id and the declared list
**Actual:** exit 0; ac_scope stored as one id 'AC-CRIT-1 AC-CRIT-2'
**Repro command:** `lore scope list task-skill-implement-f1-review-notice-and-record-every-cut`

Reported by: agent:session-c1ffea04
