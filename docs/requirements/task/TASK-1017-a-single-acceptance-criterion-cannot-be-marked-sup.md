---
id: TASK-1017
type: task
role: plan
title: "A single acceptance criterion cannot be marked superseded by another spec's criterion, so a retired AC re-verifies green against the new behaviour"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0365eb01-2e58-4fda-9ef0-f0a4fefe1b4a"}
---

Specs are execution records (ADR-041): when a later spec changes behaviour an earlier spec's AC asserted, the earlier AC must not be edited. But lore ac offers only add/list/exempt/cite/rm/set. The old AC keeps its verify.command pointing at a test file that the new spec's implementation rewrites, so lore verify on the old spec re-runs the NEW assertions and records a pass under a statement describing removed behaviour. Concrete case: spec-session-start-injection-carries-only-the-session-s-own retires SPEC-080 AC-080-1/3/6, context-provenance AC-CP-* framing, handoff-neutrality AC-096-1. Related: #132 (pass keeps showing after the test file is gone), so deleting the old test does not make the retirement visible either.

**Expected:** A per-AC superseded state (e.g. lore ac supersede <spec> <AC> --by <new-spec>:<AC> --reason), rendered distinctly in lore ac list/get, excluded from lore verify, and immutable otherwise — no edit to the old statement or command.
**Actual:** No such state exists; the only options are editing the old AC (rewrites history), removing it (refused once evidence exists), or leaving it to re-verify green against behaviour it does not describe.

Reported by: agent:session-cb37af5d
