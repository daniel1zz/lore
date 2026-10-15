---
id: TASK-1016
type: task
role: plan
title: "No mechanism says which document types are current state (edit in place) and which are execution records (never edit; supersede with a new doc)"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"governance","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b42de0e5-d3a7-414b-be7b-e0aa494c97f3"}
---

ADR-041 makes the baseline tree the only current form and specs implementations of it, but nothing in @lore/core encodes per-type role. Editing an approved spec only demotes it to draft; no gate, feed or get output tells an agent that a spec/AC/plan/task/adr/knowledge is a record that a behaviour change must not rewrite. Observed 2026-10-11: while revising the bootstrap injection, the correct split (edit BR-328/329/981 in place; new spec instead of editing SPEC-080; new test files so old ACs do not re-verify green) came only from reading ADR-041 by hand. Proposed mechanism: (1) core SSOT role per type/sub_type: current | record; (2) lore get / lore feed print the role and the change path; (3) gate refuses content edits on approved/active/archived record docs (exit 4 + feeding pack: new spec + relates-to, or supersede/invalidate), except --correction --reason; (4) lore rule impact BR-n lists current-state docs to edit vs citing records to supersede. Related: #154.

**Expected:** An agent changing behaviour is told mechanically which documents to edit in place and which to supersede, and is refused when it edits a record.
**Actual:** Role exists only in ADR-041 prose; an agent can edit SPEC-080 in place and nothing refuses or warns beyond a status demotion.

Reported by: agent:session-cb37af5d
