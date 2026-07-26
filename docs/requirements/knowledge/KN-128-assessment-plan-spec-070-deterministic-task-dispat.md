---
id: KN-128
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-070 deterministic task dispatch bundle (2026-07-23)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-050
links:
  - {id: PLAN-050, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KY7PYBP8XBHZP27HTGGWGPB9`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-070-1 | 92 | 2 pass (1 attested) per ground-truth coverage. Diff independently confirms the grep-able property: flows/task-feed-flow.ts imports only ok/truncateSection + types — none of computeAcCoverage/extractClaim/isClaimStale/extractEvidence; derivations live in task-feed-wiring.ts. Test file unseen. | 01KY7PZPS3CYD52QXYZ5NXS1AZ (T1 evidence [1][10]; import graph verified directly in diff) |
| AC-070-2 | 88 | 2 pass (1 attested). Diff shows the contract implemented: getTaskBundle failure propagated verbatim; renderPlanState/renderKnowledgeSection/renderHandoffSection each degrade only their own section to a one-line note. Assertion details in unseen test file. | 01KY7PZPS3CYD52QXYZ5NXS1AZ (T1 evidence [2][11]; degrade paths visible in task-feed-flow.ts) |
| AC-070-3 | 88 | 2 pass (1 attested). Diff shows renderAcceptance covering all matrix branches: no-ACs note, [out-of-scope] marker when ac_scope omits an id, loud ⚠ dangling-scoped-id row, and command strings for script-mode rows. Test assertions unseen. | 01KY7PZPS3CYD52QXYZ5NXS1AZ (T1 evidence [3][12]) |
| AC-070-4 | 88 | 2 pass (1 attested). Wiring keeps last ≤3 fail entries with 500-char tail clip (PRIOR_FAILURE_LIMIT/PRIOR_FAILURE_TAIL_CHARS); renderConstraints emits '(no prior failures)' and the '⚠ upstream spec not approved' advisory on upstreamSpecApproved===false. Matches AC statement. | 01KY7PZPS3CYD52QXYZ5NXS1AZ (T1 evidence [4][13]) |
| AC-070-5 | 88 | 2 pass (1 attested). renderClaim covers fresh holder / STALE marker / '(no claim)'; renderPlanState renders sessions and anchor_conflicts from the ready-report slice with explicit none-lines. Implementation in diff matches statement; test detail unseen. | 01KY7PZPS3CYD52QXYZ5NXS1AZ (T1 evidence [5][14]) |
| AC-070-6 | 88 | 2 pass (1 attested). Config subtree workflow.task_feed added (all-optional, no Zod defaults), resolveTaskStartBudgets conditional-spread, {...DEFAULT_TASK_START_BUDGETS, ...budgets} merge, clip() records only truly-clipped keys in truncated[]. Coherent end-to-end wiring visible in diff. | 01KY7PZPS3CYD52QXYZ5NXS1AZ (T1 evidence [6][15]) |
| AC-070-7 | 86 | 2 pass (1 attested); attested run shows 10 integration tests incl. happy/--json/exit-3 cases (tail truncated mid-list). Dispatch-table refactor visible in diff preserves per-branch logic verbatim; byte-unchanged regression pins live in the unseen test file, so the pin's strictness is unverified. | 01KY7PZPS3CYD52QXYZ5NXS1AZ (T1 evidence [7][16]; cli-feed-task-start.bun.test.ts unseen) |
| AC-070-8 | 83 | 4 pass (1 attested), 11 MCP tests attested green. Both branches call the same wiring as CLI (deep-equal by construction). Caveat: MCP omits config budgets, so CLI/MCP parity holds only when no workflow.task_feed config is set — documented, but narrows the AC's 'same corpus state' claim. | 01KY7PZQ54NJVWHPE3MC1ZH00J (T2 evidence [1][4]; budget-omission limitation documented in mcp/CLAUDE.md) |

## Gaps

- T1 evidence [9] is a failing --changed oracle run (6 failures in tests/unit/adapters/cli-utils.test.ts) dispositioned as pre-existing/environmental solely by the implementing agent's own output_tail note; no attested re-run confirms the disposition.
- The MCP task-start branch always uses DEFAULT_TASK_START_BUDGETS because registerTools receives no LoreConfig, so the deep-equal CLI/MCP parity AC-070-8 asserts only holds for corpora with no workflow.task_feed overrides. Documented as a known limitation, but the AC statement does not carry that qualifier.
- The byte-unchanged regression pins for spec-create/session-resume/phase-start live entirely in the omitted cli-feed-task-start.bun.test.ts; their strictness (true byte comparison vs looser assertion) cannot be inspected, only the attested pass result.

## Recommendations

- Require a failing oracle record to be closed by an attested (runner-recorded) follow-up run — either a clean re-run after rebase or an attested isolation run of the failing file — before a task archives with that evidence entry.
- Add a follow-up task to thread the parsed LoreConfig into MCP registerTools (or an equivalent budget source) and extend mcp-feed-task-start.test.ts with a budget-override parity case.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 58213ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/cli-feed-task-start.bun.test.ts, diff:packages/lore/tests/unit/flows/task-feed-flow.test.ts, diff:packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.85 | evidence | All 8 ACs have passing evidence incl. 1 attested each; diff independently confirms the render-only flow, dispatch table, config wiring, and both MCP branches. Only the MCP budget-parity edge narrows … |
| evidence_integrity | 78 | 0.75 | evidence | Every AC has an orchestrator-attested pass, but attested ratio is 0.40, T1's --changed record is a fail closed only by self-reported 'pre-existing', and test-file contents are unseen. |
| scope_fidelity | 92 | 0.85 | evidence | Diff maps 1:1 to declared task approaches: new flow/wiring/render modules, additive config subtree, shared-types extraction with re-exports, serialized tools.ts edit. Scope-Alt not needed; no drift s… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | — | T1 evidence [9] is a failing --changed oracle run (6 failures in tests/unit/adapters/cli-utils.test.ts) dispositioned as pre-existing/environmental solely by the implementing agent's own output_tail note; no attested re-run confirms the disposition. |
| outcome | minor | AC-070-8 | The MCP task-start branch always uses DEFAULT_TASK_START_BUDGETS because registerTools receives no LoreConfig, so the deep-equal CLI/MCP parity AC-070-8 asserts only holds for corpora with no workflow.task_feed overrides. Documented as a known limitation, but the AC statement does not carry that qualifier. |
| evidence_integrity | minor | AC-070-7 | The byte-unchanged regression pins for spec-create/session-resume/phase-start live entirely in the omitted cli-feed-task-start.bun.test.ts; their strictness (true byte comparison vs looser assertion) cannot be inspected, only the attested pass result. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require a failing oracle record to be closed by an attested (runner-recorded) follow-up run — either a clean re-run after rebase or an attested isolation run of the failing file — before a task archives with that evidence entry. | A self-reported 'pre-existing/environmental' disposition on the only failing record is exactly the spot where a real regression would hide. |
| plan | Add a follow-up task to thread the parsed LoreConfig into MCP registerTools (or an equivalent budget source) and extend mcp-feed-task-start.test.ts with a budget-override parity case. | Closes the one documented divergence between CLI and MCP task-start packs before any project actually sets workflow.task_feed budgets. |

## Unverifiable Materials

- packages/lore/tests/unit/flows/task-feed-flow.test.ts, tests/integration/cli-feed-task-start.bun.test.ts, tests/unit/adapters/mcp-feed-task-start.test.ts: Omitted per truncation manifest — assertion strength (byte-pin strictness, import-graph check mechanism) judged only from attested pass results.
- Pre-existing status of the 6 cli-utils.test.ts failures in T1 evidence [9]: Claimed environmental by the implementer's self-report only; no attested run or main-branch baseline shown.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.40
