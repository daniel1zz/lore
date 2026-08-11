---
id: TASK-643
type: task
role: plan
title: "lore pending does not filter invalidated docs — an invalidated draft (assessment -2 duplicate) is stuck in the review queue forever; SPEC-043 list-surface filtering should apply (or rejected+invalidated drafts need an exit path from pending)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Repro
knowledge-assessment-implementation-spec-080-prd-as-outline-2 was invalidated (superseded-by canonical) AND rejected, yet still appears in lore pending. draft status cannot be archived (VALID_TRANSITIONS has no draft->archived), so no lifecycle exit exists.
## Expected
Per SPEC-043, pending is a list-surface: invalidated docs filtered by default (badged under --include-invalid). Decide: filter in ReviewService.pending, or allow archive of invalidated drafts.
## Anchor
packages/lore/src/service/review-service.ts
## Provenance
Observed 2026-07-26 during pending-queue hygiene (this session).
