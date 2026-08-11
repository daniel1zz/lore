---
id: TASK-645
type: task
role: plan
title: "lore gate spec-promote CLI pre-flight is not spec_kind-aware — reports default floor-1 denial for domain-overview specs whose service-layer promote now passes (CLI/service parity gap widened by profile-aware min_acs fix)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Repro
adapters/cli/commands/gate.ts::runSpecPromoteGate does not resolve specKind/verificationProfile into the gate ctx; after the profile-aware AC-floor fix (acCountMeetsFloor), a domain-overview spec with min_acs:0 passes CorpusService.set/ReviewService.approve but the CLI pre-flight still denies with the default >=1 message.
## Expected
CLI pre-flight resolves the same specKind + verificationProfile ctx as the two service call sites, so lore gate spec-promote and the real enforcement path agree.
## Anchor
packages/lore/src/adapters/cli/commands/gate.ts
## Provenance
Implementer deviation report, task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 (2026-07-26).
