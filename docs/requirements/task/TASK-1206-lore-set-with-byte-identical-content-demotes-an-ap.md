---
id: TASK-1206
type: task
role: plan
title: "lore set with byte-identical content demotes an approved doc to draft and prints 'because content changed'"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"lifecycle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7d824adf-bccd-474a-b6d3-f869ca2e1f8e"}
---

Found by the review-branch probe author (plan-baseline-review-branch-migration-the-first-branch-eligible, W0) on a throwaway corpus; not fixed in that plan. CorpusService.set demotes when content is passed, not when it differs: re-saving identical text demotes an approved doc with 'demoted to draft because content changed', freezing downstream claims. Related to task-gh-1343388703-31 (empty-diff version row), but this is the demotion

**Expected:** A write whose content equals the stored content leaves an approved doc approved (and logs no version)
**Actual:** CorpusService.set demotes when content is passed, not when it differs: re-saving identical text demotes an approved doc with 'demoted to draft because content changed', freezing downstream claims. Related to task-gh-1343388703-31 (empty-diff version row), but this is the demotion

Reported by: agent:main-orchestrator
