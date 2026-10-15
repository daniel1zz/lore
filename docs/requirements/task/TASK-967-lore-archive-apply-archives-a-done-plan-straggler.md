---
id: TASK-967
type: task
role: plan
title: "lore archive --apply archives a done-plan straggler task (rule R4) without lore done's floors"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gate-bypass","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f5e17997-9fb0-4419-baa8-76651ae70faa"}
---

Found while authoring the fix spec for issue 47. packages/lore/src/adapters/cli/commands/archive.ts applies computeArchiveCandidates R4 (a non-archived, unclaimed task whose plan is archived) with a plain status write; no attested-pass, red-first, no-new-tests or unfiltered-test-file floor is checked (grep finds no attestation/floor/red_first reference in archive.ts). Once the issue-47 fix makes the plan-close cascade skip a task that fails a floor, that task becomes an R4 candidate, so lore archive --apply would archive it anyway: the bypass moves from plan close to the sweep.

**Expected:** lore archive --apply checks each R4 task against the same done floors as the plan-close cascade and lists refused tasks with the floor that refused them, writing nothing for them
**Actual:** R4 tasks are archived with no qualifying evidence

Reported by: agent:session-f0196b68
