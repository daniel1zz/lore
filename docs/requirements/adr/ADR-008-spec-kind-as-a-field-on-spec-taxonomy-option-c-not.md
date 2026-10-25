---
id: ADR-008
type: adr
role: decision
title: "spec_kind as a field on spec (taxonomy option C) — not a first-class doc type"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: SPEC-240
links:
  - {id: SPEC-240, type: informs}
---
## Context
PRD v0.5 §13 needed a document taxonomy for feature/tech/design outputs; options included new first-class doc types per kind vs a discriminating field.

## Decision
Owner approved option C: `extra.spec_kind` (feature|tech|design; later domain-overview via SPEC-080) as a field on the existing spec type — not new first-class types. Spec-under-spec mount was explicitly rejected (parent contract stays spec:[prd]).

## Consequences
One review/gate/link pipeline serves all kinds; per-kind behavior expressed via verification profiles (SPEC-058) and kind-aware predicates, never parallel type hierarchies. SPEC-080's domain-overview extension validated this shape: a 3-line enum change inherited the whole machinery.

## Source
Extracted from PRD §13 v0.5 changelog (now spec-domain-overview-output-contract-document-taxonomy) during SPEC-080 T7b owner-decision extraction.
