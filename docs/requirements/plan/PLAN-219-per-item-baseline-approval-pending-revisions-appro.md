---
id: PLAN-219
type: plan
role: plan
title: "Per-item baseline approval: pending revisions, approved-version reads, derived node status"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-220
phases:
  - {name: "P1"}
  - {name: "P2"}
---
## Goal

Implement `spec-baseline-approval-is-per-item-an-edit-adds-a-pending`: baseline approval is held per item; an edit is a pending revision while the approved version governs; every deciding reader reads approved versions.

## Phases

- **P1 code**: T1 item model, store and registry triggers following approved versions, the one-time upgrade conversion, and the approved-version accessor with every deciding reader moved onto it (AC-BIA-6, AC-BIA-7). T2 writes as pending revisions, per-item review/approve/reject, derived node status, `lore rule apply` writing approved versions (AC-BIA-1..5); blocked by T1.
- **P2 corpus**: after P1 lands: `lore migrate schema` on the shared corpus, `lore verify`, `lore rule apply`, review the pending revisions the conversion produced on the draft nodes and approve them item by item; update `assets/skills/lore-baseline/SKILL.md` and the CLAUDE.md lines stating baseline demotion; tell lore-40 that rule-service.ts and leaf-coverage.ts are free for its D1 plan.

## Risks

- lore-40's D1 plan (refusal sites declare their rule in code; deletes site_map) waits on rule-service.ts and leaf-coverage.ts; keep T1/T2 off site_map code entirely.
- The conversion touches every baseline node; it runs only through `lore migrate schema`, on a corpus snapshot first.
