---
id: PLAN-025
type: plan
role: plan
title: "SPEC-041 Implementation — session bootstrap + lossless handoff"
status: draft
priority: high
created: 2026-07-10
updated: 2026-07-10
tags: [spec-041, session]
parent: SPEC-045
---
# PLAN — SPEC-041 implementation: session bootstrap + lossless handoff

## Goal
Deliver SPEC-041 D1-D8 with all 11 script ACs green (AC-SL-8 human at closeout) and full oracle suite passing.

## Task breakdown (serial — corpus-service.ts anchor overlap)
1. **T1 core + service** — @lore/core: KNOWLEDGE_SUB_TYPES + handoff, handoffExtraSchema (incl. degraded flag), bootstrapReportSchema, handoff content renderer, workflow.handoff_ttl_minutes config; CorpusService: _createImpl handoff guard + internal createHandoffDoc port; SessionService (bootstrap/writeHandoff/resume incl. newest-wins, multi-actor, age/TTL). ACs: SL-1,2,3,5,10,11,12 + service half of SL-4.
2. **T2 adapters** — feed-flow session-resume branch; CLI commands bootstrap/handoff (+ --json-file primary path) + feed wiring + create.ts sub-type SSOT repair; MCP lore_bootstrap/lore_handoff (+ lore_feed resume); bun CLI exit-code suite. ACs: SL-4 (MCP+CLI halves), 6, 7, 9.

## Oracle
Per task: bun run typecheck + AC-named test files + full bun run test before merge. lore verify after T2. Closeout: v6 assess + AC-SL-8 owner fresh-session test + retro.
