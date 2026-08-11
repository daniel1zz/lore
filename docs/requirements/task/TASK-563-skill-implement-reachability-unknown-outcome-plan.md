---
id: TASK-563
type: task
role: plan
title: "[Skill:implement] reachability unknown outcome + plan-close ctx threading"
status: archived
priority: critical
phase: "Phase 3: Absence-as-assertion + verification"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
---
Estimate: M
Approach: TWO PARTS, both required (spec DD-4; landing only (a) is an explicitly rejected partial fix — see plan Invariant 4).
(a) Class removal: packages/lore/src/service/gate-predicates.ts::verifyReachability(planParentType, parentSpecScriptAcCount) currently returns why="parent-not-spec" for ANY planParentType !== "spec", INCLUDING undefined (= "caller supplied nothing"). Add an explicit unknown outcome for the not-supplied case, distinct from known-false. Then packages/lore/src/service/checkpoint-registry.ts::describeReachabilityWhy (lines ~668-674) must NOT render the definite claim "this plan has no spec-tier ancestor at all" for unknown — omit the reachability paragraph or state that reachability could not be determined. A gate must never assert a corpus fact it was never given.
(b) Call-site repair: packages/lore/src/service/corpus-service.ts — the plan-close GateContext starts as `{ targetIdOrSlug: existing.slug }` (line ~1898) and never sets hasSpecParent / parentSpecScriptAcCount, although `getPlanBundle` has ALREADY resolved `bundle.spec` for the prd-sync branch (lines ~1955+). Thread both from that same bundle (script-AC count via the existing countScriptModeAcceptanceCriteria helper used by review-service.ts:315).
Source: spec DD-4; explorer fact sheet; live incident 2026-07-28 (plan parented to an approved tech spec with 8 script ACs was told it had "no spec-tier ancestor at all", and offered reparent-or-exempt as the only remedies — both would have corrupted a correct corpus)
Dimensions: D-FUNC, D-SEC
Scope-Alt: none — (a) is the class fix and is non-negotiable
Covers: AC-CLOSURE-5, AC-CLOSURE-6

AC:
- Given verifyReachability called with NO planParentType, Then the result is the unknown outcome, distinguishable from the known-false "parent-not-spec" outcome.
- Given describeReachabilityWhy for the unknown case, Then the output contains neither "no spec-tier ancestor" nor any other definite negative claim about the corpus.
- Given a plan parented to a genuinely non-spec doc, Then the existing accurate "parent-not-spec" message is retained (do not regress the true-negative case).
- REGRESSION (live case): Given a plan whose parent IS an approved spec declaring >=1 script-mode AC, When plan-close denies for attestation reasons, Then the remediation text NEVER contains "no spec-tier ancestor" and the reachability inputs are populated.
- `bun run typecheck` exit 0; existing checkpoint-registry and gate-predicate suites stay green.
