---
id: TASK-1137
type: task
role: plan
title: "Under enforce, a criterion's only citation cannot be removed even after it is exempted: the cite gate ignores exemptions on revised criteria"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gate-design","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f754f16f-8b67-4f68-8b99-1a05abb66827"}
---

Found right after arming the citation gate (plan-baseline-fast-mode-migration-of-the-remaining-9-branches). Workarounds rejected: switching the gate to report to slip the removals through is a gate bypass. The gate should treat an actively exempted criterion as admitted when uncited (decideCiteGate / findAcCiteViolations), and exempting a still-cited criterion should be either refused or made the sanctioned first step.

**Expected:** Removing a criterion's sole citation is admitted when the criterion holds an active exemption (or another sanctioned path exists to retract a citation judged unfaithful), so a known-wrong citation can be taken out under enforce
**Actual:** Measured on the live corpus 2026-10-09 with ac-cite mode enforce on all 12 branches: 'lore ac cite <spec> AC-069-5 BR-115 --remove' -> exit 4 AC_CITE_REQUIRED; 'lore ac exempt <spec> AC-069-5 ...' -> exit 0 (exempting a still-cited criterion is accepted); the same --remove afterwards -> still exit 4. 8 citations judged unfaithful in the AC-BLS2-14 sample remain in the corpus because of this (AC-069-5, AC-RR-4, AC-ADV-1, AC-076-8, AC-053-7, AC-061-11, AC-068-1, AC-OX-2)

Reported by: agent:main-orchestrator
