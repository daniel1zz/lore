---
id: TASK-963
type: task
role: plan
title: "lore rule add|set demotes an approved baseline leaf to draft without saying so on stdout"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"silent-state-change","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"5e468123-7005-43ed-b34d-d347f3033588"}
---

Measured 2026-10-12: lore rule add baseline-approve-a-document ... printed only 'Added BR-1071 to baseline-approve-a-document (v142).' while lore log shows v141 'Demoted to draft: rule add edits approved content' and the leaf is now draft. Same for rule set (statement edit and --lifecycle retired) on 8 other approved leaves. rule-service.ts demoteIfApproved writes the demotion as its own version; the CLI output names only the final version. The corpus workflow rule says lore set's stdout must announce the approved->draft demotion because it predicts the next gate denial; the rule verbs drop that signal.

**Expected:** rule add / rule set print the demotion (e.g. 'baseline-x was approved and is now draft; re-review and approve it') whenever demoteIfApproved wrote one, and --json carries it as a field
**Actual:** stdout says only 'Added BR-n to <leaf> (vN)' / 'Updated BR-n [live] on <leaf> (vN)'; the demotion is visible only via lore get or lore log

Reported by: agent:session-f0196b68
