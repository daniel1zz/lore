---
id: TASK-310
type: task
role: plan
title: "spec-promote base >=1-AC rule is spec_kind-agnostic — SPEC-080 C2's 'domain-overview needs no ACs' is unimplementable; make the AC floor profile-aware or codify the parity-AC pattern"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Context
SPEC-080 C2 + SPEC-058 profiles declare domain-overview a narrative kind with a lighter floor, but the spec-promote gate's base >=1-structured-AC rule fires regardless of kind (observed 2026-07-26: every migrated domain-overview spec was blocked until given an AC-DOV-1 parity AC bound to the migration dry-run oracle).
## Options
(a) profile-aware AC floor (workflow.verification_profiles.<kind>.min_acs, 0 legal); (b) codify AC-DOV-1 parity-AC as the standing domain-overview convention (it IS a real oracle) and update C2's prose to match as-built.
## Anchor
packages/lore/src/service/gate-predicates.ts
