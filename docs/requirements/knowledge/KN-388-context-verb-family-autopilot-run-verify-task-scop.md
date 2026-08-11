---
id: KN-388
type: knowledge
role: knowledge
title: "Context verb family autopilot run — verify task-scoping semantics, legacy-shape upgrade paths, TDD-paired worktree dispatch"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: [retro, autopilot, worktree, verify]
parent: PRD-001
links:
  - {id: PLAN-088, type: informs}
  - {id: KN-389, type: relates-to}
---
Execution learnings from the fully-autonomous 12-task run of plan-implementation-context-verb-family-two-zone-claude-md (6 waves + 1 fix-loop, 7/7 attested ACs, zero blocked tasks).

1. **`lore verify --task` runs the WHOLE spec's script ACs, not a task-scoped subset** (by design: ACs are spec-level; --task is attribution, not filtering). Mid-plan per-task attested verify therefore re-runs every not-yet-implemented AC (guaranteed red noise) and any full-suite AC (7 minutes each). Correct cadence: worktree implementers run scoped oracles + record evidence; ONE attested `lore verify <plan>` at close-out.
2. **Upgrade-path semantics are an implicit input set**: introducing per-section fingerprints made every pre-upgrade install (fingerprint-less marker zones) hit fail-loud VALIDATION_ERROR → converge would report "failed" forever. A spec that introduces new on-disk bookkeeping MUST define semantics for the legacy shape explicitly (resolution here: legacy adoption — zone with ZERO fingerprints is wholesale-replaced and migrated one-way; VALIDATION_ERROR reserved for structural damage/malformed fingerprints). Caught by honest fail-evidence from a worktree implementer, fixed in one orchestrator-adjudicated fix-loop dispatch.
3. **TDD-paired dispatch worked cleanly at 2-3 way parallelism** with disjoint anchors; the RED-suite-as-executable-contract pattern (test task documents its authoring decisions in the file header; paired implementer treats tests as authoritative for shape, spec for D-level decisions) resolved every ambiguity without re-litigation.
4. Assessment follow-ups (see knowledge-assessment-implementation-context-verb-family-two): RED-phase evidence should record the failing run's verbatim counts instead of oracle=manual/result=pass; implement tasks should sweep stale "RED today" strings from test names when turning suites green.
