---
id: PLAN-021
type: plan
role: plan
title: "Implementation — P4 feed-before-produce + provenance linkage"
status: approved
priority: high
created: 2026-07-09
updated: 2026-07-09
tags: [ioc, p4, feed, provenance]
parent: SPEC-041
phases:
  - {name: "Core: governs + feed", description: "governs enum + lore feed command/MCP over findFeedingSkill+gate-feeding"}
  - {name: "Provenance + query", description: "auto-write governs at _createImpl (fail-soft) + --governed-by + nav backlink"}
  - {name: "Push + e2e", description: "best-effort gate push + closed-loop e2e + full sweep"}
---
## Goal
Implement SPEC P4 (option γ): feed-before-produce (deterministic `lore feed` pull + best-effort gate push) + bidirectional provenance (`governs` skill→artifact link + reverse query), as a vertical slice through the spec-production node. Reuse findFeedingSkill (P1) + gate-feeding (slice-1) + link table. feed never blocks; provenance never fails a create.

## Phases
1. **Core: governs + feed** — `governs` enum value + `lore feed` command/`lore_feed` MCP over existing feed primitives.
2. **Provenance + query** — auto-write skill--governs-->doc at _createImpl (fail-soft, idempotent) + `--governed-by` filter + nav backlink.
3. **Push + e2e** — best-effort gate allow-path push + closed-loop e2e + full sweep.

## Invariants
- feed content SSOT with the gate's violation pack (same findFeedingSkill + gate-feeding).
- provenance write is FAIL-SOFT: a link failure NEVER fails the create (doc is SSOT).
- feed is advisory context — never blocks, exit 0 always.
- approved-only skills feedable (tamper gate); [source,trust] header retained.
- ⛔ tests use throwaway corpus, never repo `.lore`.
