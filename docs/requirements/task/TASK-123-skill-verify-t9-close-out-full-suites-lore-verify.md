---
id: TASK-123
type: task
role: plan
title: "[Skill:verify] T9 Close-out: full suites + lore verify + assess + arming decision handoff"
status: draft
priority: critical
phase: "Phase 4: Corpus migration & close-out"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
---
Estimate: M
Approach: main-checkout close-out: full `bun run typecheck` + both full test runners + dashboard e2e; `lore verify <plan> --allow-new-commands` for script ACs whose commands exist; `lore assess <plan> --diff <first-task-commit>..HEAD`; record the Phase-3 arming decision (advisory→exit-3 flip + predicate knob ON after 2 clean plan-close observations) as a follow-up handoff.
Source: plan Exit Criteria; SPEC-080 Migration Plan Phase 3
Dimensions: D-FUNC
Scope-Alt: none — this is the final gate.
Covers: AC-080-8, AC-080-9

AC:
- Given main checkout post-merge, When `bun run typecheck && bun run test`, Then exit 0 with LORE_ACTOR=agent:main-orchestrator on all evidence writes.
- Given `cd packages/dashboard && bunx playwright test`, Then exit 0.
- Given `lore verify <plan> --allow-new-commands`, Then every executed script AC passes (attested); non-executable ACs itemized with reason.
- Given the LIVE migrated corpus, When `lore bootstrap --json | wc -c`, Then < 32000 (link-only injection pin on the real corpus, not only the fixture).
- Given `lore assess <plan>`, Then verdict recorded; gaps fixed or accepted with rationale in the assessment doc.
- Handoff written (`lore handoff --plan <plan>`) carrying the arming follow-up.
