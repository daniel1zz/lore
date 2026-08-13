---
id: KN-125
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-27
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

## Plan

(none)

## Task Refs

(none)

## Modified Files

- assets/agents/lore-implementer.md
- assets/skills/lore-autopilot/SKILL.md
- assets/hooks/pre-bash-git-safety-gate.mjs
- packages/dashboard/tests/setup.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| SPEC-065/066/067 implemented+merged+attested (19 ACs runner-pass), full oracle green on main (typecheck 0 / vitest 288 files / bun 983); assessments met-88 / partial-70 / partial-72@0.9 | — |
| 068 numbering collision resolved: main CLAUDE.md index is numbering SSOT — slugify=SPEC-068, attestation chain renumbered SPEC-069 (re-approved); corpus slugs still carry stale spec-068 prefix@0.95 | — |
| oracle-contention root cause was stacked: orphaned agent-browser swiftshader Chrome (dominant baseline) + N-way concurrent full suites (increment); scoped-oracle dispatch now mechanized in implementer/autopilot templates@0.85 | — |

## Failing Oracle

(none)

## Next Steps

- Implement SPEC-069 (attestation floor + ad-hoc task channel) via plan-plan-spec-068-attestation-floor-ad-hoc-task-channel — 3 ready tasks, AC-069-1..7
- After slugify's lore set --slug is confirmed on main, repair stale slugs spec-spec-068-execution-time-attestation-floor-ad-hoc-task-chann and plan-plan-spec-068-attestation-floor-ad-hoc-task-channel to 069-prefixed names
- 066/067 assessment follow-ups: task docs left in draft status (admin); rewrite 067's mislabeled negative test to parse llmAssessmentOutputSchema directly
- Guyin-reported P0-1/P0-3 need no lore fix (stale binary / harness auto-clean) — consider notifying guyin to update installed lore binary
