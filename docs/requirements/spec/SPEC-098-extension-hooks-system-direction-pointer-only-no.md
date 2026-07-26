---
id: SPEC-098
type: spec
role: spec
title: "Extension Hooks System (direction pointer only — no commitment) (domain overview)"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## 19. Extension Hooks System (direction pointer only — no commitment)

**Direction (owner, 2026-07-19)**: generalize the proven internal extension seams (checkpointRegistry/GateEnforcer for blocking predicates; telemetry for observation) into a first-class event/hook system. Deliberately NOT designed here (its own §14.6-style rule applied at section granularity: no consumer, no detail) — the design round's inputs (event-catalog derivation, blocking/advisory handler split, versioned payloads, the k8s-style `labels` selector namespace, §M2 threat-model inheritance for shell-out handlers) are recorded in a knowledge/ideation doc, not in this PRD. No goal attaches until that round produces an ADR + spec. The `labels` field's schema admission is deferred to that spec (§18 P5 admission rule: no consumer yet, no field).

## Acceptance Criteria (structured)

- [·] [script] AC-DOV-1: Content parity with source PRD section holds: lore migrate prd-to-outline --dry-run for this section exits 0 reporting already_migrated=true with 0 failed invariants (char-coverage, section-ref set equality, R-id set equality)
  script: e2e — lore migrate prd-to-outline --prd prd-lore-internal-first-ai-team-knowledge-platform --section extension-hooks-system-direction-pointer-only-no-commitment --dry-run
