---
id: TASK-1298
type: task
role: plan
title: "lore ac cite cannot re-point a criterion whose existing citation was retired; only lore ac set --cite can"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"gate-design","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"98771ffa-e5e4-4707-8bf8-517d9fa5d37d"}
---

2026-10-12: after retiring BR-1080 (moved into a change set as BR-1082), 'lore ac cite <spec> AC-IC-1 BR-1082' was refused by the citation gate (AC_CITE_REQUIRED: 'AC-IC-1 cites BR-1080, which is retired') and wrote nothing; '--remove BR-1080' was refused the same way. The refusal's own suggestion is a 'lore ac cite …' line, which cannot succeed. 'lore ac set <spec> <AC> --cite BR-1082' (whole-list replace) worked. So retiring a rule strands every criterion citing it unless the author knows the set path.

**Expected:** lore ac cite can add a live/own-proposed id (and --remove a retired one) on a criterion whose other citation is retired, or the refusal names lore ac set --cite
**Actual:** cite and cite --remove both refused; the hint points at the refused command

Reported by: agent:session-cb37af5d
