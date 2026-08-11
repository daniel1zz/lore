---
id: KN-387
type: knowledge
role: knowledge
title: "Stale in-context snapshot replayed as current state in a cross-plan report — timeless-context bias, mechanized at reporter layer"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: [retro, process, multi-session, reporting]
parent: PRD-001
links:
  - {id: PLAN-088, type: informs}
---
## Incident
An autopilot final report claimed a SIBLING plan (content-contract) "still has 3 open Phase 3 tasks". Reality: a parallel session had completed and archived the entire plan hours earlier. The claim came from a `lore tree` snapshot taken ~4h before the report, replayed from context memory without re-querying.

## Root cause (5 Whys)
1. Report section enumerated cross-plan state hand-assembled from context memory.
2. LLM context is timeless — a tool output from 4h ago and 4s ago are epistemically indistinguishable in-context; "seen once" masquerades as "still true". Existing discipline ("非亲眼所见默认不可信") guards hearsay, not seen-but-stale.
3. Environment amplifier: this is a MULTI-SESSION CONCURRENT workspace (the very premise of lore's claims/anchors/sessions design) — cross-session staleness is the expected case, not the exception. Single-agent priors do not transfer.
4. Mechanism gap: lore mechanizes freshness on the tool side ("readiness is always computed, never hand-marked") but nothing governed the REPORTING side — prose status narration reintroduced the hand-marking anti-pattern one layer up.

## Mechanization landed (2026-07-27, this session)
- lore-autopilot SKILL.md Final report step: every shared-state claim MUST derive from queries run after closure in the same turn; other plans' status is optional and must be freshly queried or explicitly timestamped as "as of".
- Global CLAUDE.md 行为准则: new trigger — progressive-tense statements about shared mutable state ("仍有/还没/正在/claimed") require same-turn evidence, else must be narrated as "当时".

## Distribution completion (added same day after owner review)
The first landing was itself wrong-sided: personal ~/.claude/CLAUDE.md is not a lore surface, and the installed skill copy only reached the SSOT via a dev-machine symlink accident. Re-routed per adr-distribution-first-every-improvement-names-its-consumer: the reporter rule lives in assets/skills/lore-autopilot/SKILL.md (SSOT, manifest regenerated), and the shared-state re-evidencing discipline was added to assets/governance/corpus-workflow.md EXECUTE (session-injected for every consumer on binary upgrade).

## Standing lesson (generalizable)
State assertions carry an implicit observation timestamp. Any cross-turn state assertion about shared mutable resources must be re-evidenced at assertion time — the reporting layer deserves the same computed-not-stored discipline lore already enforces at the tool layer.
