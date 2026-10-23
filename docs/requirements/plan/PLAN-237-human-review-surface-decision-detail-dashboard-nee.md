---
id: PLAN-237
type: plan
role: plan
title: "Human review surface: decision detail, dashboard Needs-you, decide links"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-206
phases:
  - {name: "record-and-read", description: "Decision detail, read routes, server registry, bootstrap next"}
  - {name: "surfaces", description: "Dashboard Needs-you page; decide/pending link"}
---
## Goal

Deliver spec-human-review-surface-decisions-audit-items-and-pending: decisions carry a plain-language detail; the dashboard shows open decisions, audit items and documents awaiting review read-only; `lore decide` / `lore pending` link to the detail page.

## Invariants

- Answering a decision stays terminal-only (`lore decide`); no HTTP route or MCP tool answers, and no route path contains `decide` (AC-AU-3 (4)).
- Reading decisions appends nothing to the decision log.
- No reader, prompt or test assumes a dashboard port.
- `detail` is inside the hash-chained payload; existing rows still verify.
- Tests use throwaway corpora only; never the repo's `.lore/`.

## Phases

1. record-and-read — HR-T1 (detail field + chain + governance-loosen), HR-T2 (other producers), HR-T3 (read routes), HR-T4 (server registry), HR-T5 (bootstrap next).
2. surfaces — HR-T6 (dashboard Needs-you page), HR-T7 (decide / pending detail lines and link).

Dependencies: T1 blocks T2, T3, T7; T3 blocks T6; T4 blocks T7.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Changing the chained payload breaks verification of existing rows / pushed heads (verify-pushed-heads) | H | detail enters the hash only for rows that carry it (versioned payload); AC-HR-2 asserts old rows verify |
| Read route reuses listPending and writes | M | AC-HR-3 asserts row count and chain head unchanged |
| Registry file left behind by a killed server points at a dead URL | M | pid liveness check; AC-HR-5 dead-pid case |
| Open-redirect via bootstrap next | M | AC-HR-7 absolute, //host and backslash cases |
