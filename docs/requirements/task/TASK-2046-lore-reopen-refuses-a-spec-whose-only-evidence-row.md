---
id: TASK-2046
type: task
role: plan
title: "lore reopen refuses a spec whose only evidence rows name no criterion, although BR-1050 forbids reopen only for evidence against its criteria"
status: archived
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PRD-001
---
GitHub issue: https://github.com/daniel1zz/lore/issues/461

A pre-registered stop-and-re-review (plan-evaluation-1 Decisions Log, O1-S2 path B) must reopen spec-evaluation-metric-envelope-and-honest-origins. The reopen gate refuses it because the plan's experiment tasks recorded no-criterion evidence (lore evidence --capture of a research doc). ReviewService.countSpecEvidence (packages/lore/src/service/review-service.ts, near line 1405) counts every evidence entry of every task under the spec via countEvidenceEntries, including entries with no ac_id.

**Expected:** BR-1050 (baseline-reopen-an-approved-spec): no evidence may exist against the spec's CRITERIA. A spec whose tasks hold only no-criterion evidence (verification_evidence entries with no ac_id) can be reopened
**Actual:** lore reopen spec-evaluation-metric-envelope-and-honest-origins --reason <r> fails: 'Validation failed on field gate:reopen: Cannot reopen spec-evaluation-metric-envelope-and-honest-origins: 4 evidence rows already exist against it. A spec with evidence cannot be reopened - supersede it with a new spec instead.' None of the 4 rows (the 4 experiment tasks of plan-evaluation-1) carries an ac_id

**Repro command:**
```
lore reopen spec-evaluation-metric-envelope-and-honest-origins --reason probe
```

**Refs:**
- spec-evaluation-metric-envelope-and-honest-origins

Reported by: agent:session-7903287b
