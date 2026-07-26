---
id: KN-131
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-070 review-fix wave (2026-07-24)"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-048
links:
  - {id: PLAN-048, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KY8XQN9NPGMYP3V9CZFK4KWC`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-070-1 | 58 | Regression-floor AC; not a wave target. Coverage 0/0 in this snapshot — no re-run evidence shown. Not contradicted (flow import-graph invariant reaffirmed in wiring header). | — |
| AC-070-2 | 58 | Pre-existing AC, not this wave's scope. No evidence recorded here; aux-port degrade behavior actually hardened by F5. Unverified but plausibly green. | — |
| AC-070-3 | 58 | Regression floor, 0/0 coverage in snapshot. Not re-evidenced this wave; not contradicted by the diff. | — |
| AC-070-4 | 58 | Pre-existing constraints-render AC; no direct evidence in wave. Related F1/F2 fixes touch this section but AC itself unverified here. | — |
| AC-070-5 | 58 | Pre-existing claim/plan_state AC; 0/0 coverage, no re-run shown. Unverified regression floor. | — |
| AC-070-6 | 58 | Pre-existing budget-override AC; no wave evidence. Budget resolver reused unchanged by F6, indirect support only. | — |
| AC-070-7 | 85 | CLI dispatch refactor (F7) directly touches this. Integration suite passes with HAPPY task-start section-header + --json tests explicitly tagged AC-070-7 in evidence output. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [15]/[22] cli-feed integration pass) |
| AC-070-8 | 58 | Pre-existing MCP deep-equal AC; no wave evidence recorded. MCP task-start path reworked by F6/F8 but this AC not re-run in snapshot. | — |
| AC-070-9 | 62 | Budget-parity AC superseded in shape by F6/AC-070-15 (getter). AC-070-15 evidenced 3 pass; parity path exercised, but AC-070-9's own test not re-run here. | 01KY8XRAQ39HY1F04AM9077TJ8 |
| AC-070-10 | 93 | F1 clearly implemented: bare .slice replaced by headChars(@lore/core) at wiring line. 3 pass, 2 attested; astral-plane surrogate-safety test present. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [9]/[16]) |
| AC-070-11 | 93 | extractEvidenceTolerant + renderConstraints degraded line implemented; unparseableEvidenceCount threaded through bundle/flow. 3 pass, 2 attested. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [10]/[17]) |
| AC-070-12 | 94 | deriveAcCoverageState added to core with fail-first ordering; both ac.ts coverageBadge and wiring deriveCoverageLabel now delegate. Genuine SSOT. 3 pass, 2 attested. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [11]/[18]) |
| AC-070-13 | 93 | Present-but-invalid ac_scope now returns VALIDATION_ERROR naming plan.extra.ac_scope; absent stays legal. Diff matches AC exactly. 3 pass, 2 attested. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [12]/[19]) |
| AC-070-14 | 93 | Both aux bindings now propagate err on refetch failure instead of manufacturing invalidated:false / title=slug rows. Implemented as specified. 3 pass, 2 attested. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [13]/[20]) |
| AC-070-15 | 93 | getConfig getter threaded index→startMcpServer→registerTools, called per invocation; loadProjectConfig reuses canonical parse. 3 pass, 2 attested. | 01KY8XRAQ39HY1F04AM9077TJ8 (evidence [1]/[4]/[6]) |
| AC-070-16 | 94 | SPECIAL_FEED_CHECKPOINTS descriptor + assertHandlersCoverDescriptor init check + MCP combo rejection all implemented across feed-flow/feed.ts/tools.ts. 12 pass under filter, 2 attested. | 01KY8XRAQ39HY1F04AM9077TJ8 (evidence [2]/[5]/[7]) |
| AC-070-17 | 92 | relatedKnowledge threaded (task fetched once); computeAcCoverage single-pass Map bucketing preserving (task,entry) order → output-identical, core acceptance floor passed. 3 pass, 2 attested. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [14]/[21], acceptance.test.ts floor [3]/[6]) |
| AC-070-18 | 87 | Phase-start happy-path pin claimed; integration suite passes (3 pass, 2 attested). Test file itself omitted by truncation so full-output assertion not directly visible, but coverage attested. | 01KY8XRA9WRZP0AK34EQ2R3CEA (evidence [15]/[22]) |

## Gaps

- Regression-floor ACs 1-6,8 show 0 pass/0 fail in this snapshot — no evidence they were re-run after the dispatch/config/wiring refactors. The invariant that they 'stay green' is asserted, not demonstrated here; only AC-070-7 gets indirect integration confirmation.
- The phase-start happy-path full-output regression pin is in an omitted integration test file; its existence is inferred from attested coverage (3 pass, 2 attested) rather than a directly reviewable assertion.

## Recommendations

- Include the planned post-merge full-suite run in the evidence trail so pre-existing ACs 1-9 are positively re-verified, not assumed, after this wave's cross-cutting dispatch/config changes.
- File the deferred App-carriage config decision (architecture finding #2) as its own ADR/spec item so the getter-param interim fix does not become permanent by omission.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 117199ms
- Retried: false
- Truncated sections: task:task-skill-implement-fixa-wiring-core-surrogate-clip-tolerant, diff:packages/lore/tests/integration/cli-feed-task-start.bun.test.ts, diff:packages/lore/tests/unit/adapters/task-feed-wiring.test.ts, diff:packages/lore/tests/unit/flows/task-feed-flow.test.ts, diff:packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.85 | evidence | All 9 wave-target ACs (10-18) implemented per finding and evidenced 3 pass / 2 attested each; diff mechanically matches each named fix. |
| evidence_integrity | 84 | 0.8 | evidence | Independent main-orchestrator re-runs corroborate agent runs; attested ratio 0.62. Scoped -t oracles + typecheck pass. Test-file bodies omitted (truncation, not penalized). |
| scope_fidelity | 90 | 0.85 | evidence | Two disjoint tasks match declared phases; arch finding #2 explicitly deferred with rationale. No unexplained drift beyond planned F1-F10 fixes. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-070-1 | Regression-floor ACs 1-6,8 show 0 pass/0 fail in this snapshot — no evidence they were re-run after the dispatch/config/wiring refactors. The invariant that they 'stay green' is asserted, not demonstrated here; only AC-070-7 gets indirect integration confirmation. |
| outcome | minor | AC-070-18 | The phase-start happy-path full-output regression pin is in an omitted integration test file; its existence is inferred from attested coverage (3 pass, 2 attested) rather than a directly reviewable assertion. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Include the planned post-merge full-suite run in the evidence trail so pre-existing ACs 1-9 are positively re-verified, not assumed, after this wave's cross-cutting dispatch/config changes. | Wave touches dispatch, config threading, and core aggregation; regression floor should be shown, not asserted. |
| spec | File the deferred App-carriage config decision (architecture finding #2) as its own ADR/spec item so the getter-param interim fix does not become permanent by omission. | Decisions Log flags it as a structural pass needing its own scope. |

## Unverifiable Materials

- Full regression-suite run for AC-070-1..9: Coverage 0/0 in snapshot; the 'full suite once on main post-merge' run is not included in the materials.
- Omitted test files (task-feed-wiring, task-feed-flow, mcp-feed-task-start, cli-feed integration): Bodies truncated for budget; assertions inferred from attested coverage rather than read.

## Facts Summary

- AC coverage: 18 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.62
