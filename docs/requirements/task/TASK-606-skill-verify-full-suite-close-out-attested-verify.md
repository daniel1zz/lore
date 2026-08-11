---
id: TASK-606
type: task
role: plan
title: "[Skill:verify] full-suite close-out: attested verify, code anchors, domain-doc sync, assess"
status: archived
priority: critical
phase: "Phase 3: Convergence & Verification"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
---
Estimate: M
Approach: main-checkout close-out after all merges: (1) full suite `bun run test` + `bun run typecheck` on main; (2) `LORE_ACTOR=agent:main-orchestrator lore verify plan-implementation-project-claude-md-content-contract` — attested runs of AC-CMC-1..5 (judgeCompleteness guards zero/under-match; `bun run build` first for compiled e2e); (3) declare spec code anchors (`lore anchor add` for claude-md-check.ts, governance.ts, status.ts, config.ts, contract asset) then `lore status --check-drift` exit 0; (4) update distribution domain doc + PRD outline links per SPEC-080 plan-close sync predicate; (5) UAT: exercise the three consumer surfaces as a user would (fresh `lore setup --project` repo → pointer visible; oversized CLAUDE.md → push blocked with repair pointer; `lore governance claude-md` readable) and record the P0 verdict via `lore uat record` (plan declares requires_uat — plan-close gates on a P0-accepted UAT); (6) `lore assess` the plan, triage findings.
Source: plan Exit Criteria; SPEC-080 plan-close; SPEC-054 uatP0Accepted; repo standing rule (full suite on main only)
Dimensions: D-FUNC, D-DOC
Scope-Alt: assess-diff range derives from this plan's first task commit (standing lesson)
Covers: AC-CMC-1, AC-CMC-2, AC-CMC-3, AC-CMC-4, AC-CMC-5 (attestation pass)

AC:
- Given all prior tasks archived, When `lore verify` runs, Then all 5 script ACs report attested pass (no inconclusive)
- Given the landed code, When `lore status --check-tree --check-drift` runs, Then exit 0
- Given the domain doc update, When plan-close gate evaluates, Then prd-sync predicate passes without exemption
- Given the three-surface UAT journey (setup --project pointer / hook-trip block+repair-pointer / governance readability), When `lore uat record` captures the verdict, Then a P0-accepted UAT exists and plan-close's uatP0Accepted predicate passes
- Integration: `git push` succeeds through the four-check pre-push chain on main
