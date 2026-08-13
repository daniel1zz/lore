---
id: TASK-125
type: task
role: plan
title: "[Skill:verify] T7b Live-corpus core condensation §1-§13 + owner-decision ADR extraction"
status: archived
priority: critical
phase: "Phase 4: Corpus migration & close-out"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-123, type: blocks}
---
Estimate: M
Approach: main-agent corpus operation, successor to T7a: condense core sections §1-§13 to tier "core" outline entries (<= 4000 chars each), extract embedded owner decisions into `adr` docs (`informs`-linked from the owning domain/core entry), finish with the whole-doc budget read. Every step `lore restore`-recoverable.
Source: SPEC-080 Migration Plan Phase 2; T7a evidence trail
Dimensions: D-FUNC
Scope-Alt: ADR extraction may land as a follow-up batch if section count exceeds session budget — outline entries then point at the domain doc only (decision recorded in evidence).
Covers: AC-080-1, AC-080-9 (partial)

AC:
- Given the migrated live corpus, When `lore get <root-prd> --raw | wc -c`, Then <= 24000.
- Given `lore status --check-prd-budget`, Then exit 0 on the live corpus.
- Given `lore status --check-tree --check-drift --check-requirements`, Then exit 0.
- Given each extracted owner decision, Then an `adr` doc exists with `informs` link and the outline entry's decision_pointers reference it.
- Evidence recorded per step; root PRD id/slug unchanged (I3).
