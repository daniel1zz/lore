---
id: ADR-010
type: adr
role: decision
title: "Dashboard review queues include in-review docs ahead of drafts"
status: draft
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
links:
  - {id: TASK-316, type: informs}
---
## Context

The dashboard's "Pending Review" panel and `/pending` Triage Queue list only `draft` docs (CLI `lore pending` semantics). A doc in `in-review` — the one state that renders an AdjudicationBar and is literally awaiting approve/reject — appears in NO queue; its only discovery path is a manual Library status filter (dogfood 2026-07-26 ISSUE-008).

## Decision

Dashboard review queues (home PendingPanel + TriageQueue) include BOTH `draft` and `in-review` docs. `in-review` entries sort ahead of drafts and carry a visible status distinction (the existing StatusPill / a section divider — implementation's choice, but the two states must be visually distinguishable in the row). CLI `lore pending` semantics stay unchanged (it is documented as "draft docs pending review"); this is a dashboard-surface decision, implemented at the dashboard read layer (widened query/merge), not by redefining the CLI verb.

## Consequences

- The adjudication loop closes: everything reviewable is reachable from a queue.
- Queue counts shown on the home panel now mean "docs needing review attention" (draft + in-review) — copy stays truthful without renaming.
