---
id: KN-056
type: knowledge
role: knowledge
title: "Assessment: SPEC-045 Implementation — doc-code drift oracle (2026-07-12)"
status: archived
priority: medium
created: 2026-07-12
updated: 2026-10-23
tags: []
parent: PLAN-029
links:
  - {id: PLAN-029, type: informs}
---
# Assessment: met (89/100)

Scope: plan `01KXB0WEW6EPXQP6YT9GZJB2T1`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DR-1 | 92 | code-anchors.test.ts 48 tests pass, independently attested (daniel-via-agent-proxy). Diff for pure layer omitted but referenced consistently; grammar/scan/six-kind classification well covered. | 01KXB0X3VMNE4VZKK1AS34TTMP (48/48 attested) |
| AC-DR-2 | 91 | drift-check-service.test.ts 27 tests pass, attested. Service orchestration, probe dedup, probe_error isolation, no-node:fs-import oracle covered. | 01KXB0X3VMNE4VZKK1AS34TTMP (27/27 attested) |
| AC-DR-3 | 90 | Same service test file (27 pass, attested) covers CAS RMW, sibling-key preservation, grammar rejection, D6a seams. Diff shows addCodeAnchors/removeCodeAnchors/setCodeAnchors wiring. | 01KXB0X3VMNE4VZKK1AS34TTMP |
| AC-DR-4 | 90 | cli-drift.bun.test.ts 13 pass, attested. status.ts restructure to value-returning + exit precedence (3>4>0) visible in diff; repair hints and armed count implemented. | 01KXB10VZQNF9HMEXE66NW1JCP (13/13 attested) |
| AC-DR-5 | 90 | mcp-drift.test.ts 9 pass, attested. Diff shows lore_status migration to registerToolWithArgs (first schema), argless regression, spec-target REPLACE divergence documented, tool count 30. | 01KXB10VZQNF9HMEXE66NW1JCP |
| AC-DR-6 | 89 | spec-projection-anchors.test.ts 8 pass, attested. Projection file omitted from diff but referenced; zero-probe regression asserted in AC and test count. | 01KXB10VZQNF9HMEXE66NW1JCP |
| AC-DR-7 | 91 | config-drift.test.ts 8 pass, attested. resolveDriftEnabled imported/used in status.ts; strict-Zod default-true behavior covered. | 01KXB0X3VMNE4VZKK1AS34TTMP |
| AC-DR-8 | 89 | Read-only guarantee tested in drift-check-service.test.ts (27 pass, attested) via write-counting store oracle per AC statement. | 01KXB0X3VMNE4VZKK1AS34TTMP |
| AC-DR-9 | 80 | Human/owner live run: 1 pass, exit 0 consistent → rename → drift (symbol_missing). Legitimate but output_tail truncated mid-'fix:' hint and run was owner-authorized agent proxy, not direct owner; 0 attested (expected for human mode). | 01KXB10VZQNF9HMEXE66NW1JCP (manual run-ac-dr-9.sh, truncated tail) |

## Gaps

- Human live-run output_tail is cut off at 'fix: ', so the literal repair-hint string is not fully observable in captured evidence; run was via owner-authorized agent proxy rather than direct owner execution.
- Attested-evidence ratio is 0.38 and several implementing files (drift-flow.ts, projection, test files) are outside the shown diff, so their internals rely on attested test passes rather than direct review.

## Recommendations

- Preserve complete (untruncated) command output for human-mode ACs so the asserted literal strings (e.g. the repair hint) are verifiable end-to-end.
- Add a knowledge-capture deliverable recording SPEC-045 design learnings (first-schema MCP migration, drift>tree exit precedence).

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 47583ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:packages/lore/src/flows/drift-flow.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/outline-service.ts, diff:packages/lore/tests/unit/adapters/cli-drift.bun.test.ts, diff:packages/lore/tests/unit/adapters/mcp-drift.test.ts, diff:packages/lore/tests/unit/adapters/spec-projection-anchors.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 91 | 0.85 | evidence | All 8 script ACs pass with attested reruns; live human AC passed. Diff coherently implements dispatch, restructured exit precedence, shared drift-flow, real-fs-probe, MCP migration. |
| evidence_integrity | 86 | 0.8 | evidence | Each script AC has an independent attested rerun (daniel-via-agent-proxy) plus typecheck and full-suite passes. Ratio 0.38 moderate; AC-DR-9 tail truncated. |
| scope_fidelity | 92 | 0.82 | evidence | Diff aligns tightly with plan T1/T2 anchors; app.ts composition-root edits in T2 as planned. No unexplained additions; every AC in-scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-DR-9 | Human live-run output_tail is cut off at 'fix: ', so the literal repair-hint string is not fully observable in captured evidence; run was via owner-authorized agent proxy rather than direct owner execution. |
| evidence_integrity | minor | — | Attested-evidence ratio is 0.38 and several implementing files (drift-flow.ts, projection, test files) are outside the shown diff, so their internals rely on attested test passes rather than direct review. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Preserve complete (untruncated) command output for human-mode ACs so the asserted literal strings (e.g. the repair hint) are verifiable end-to-end. | AC-DR-9's tail was clipped mid-hint, weakening otherwise-passing human evidence. |
| plan | Add a knowledge-capture deliverable recording SPEC-045 design learnings (first-schema MCP migration, drift>tree exit precedence). | Zero linked knowledge docs; SPEC-044 retro learnings were cited as inputs, so continuity is valuable. |

## Unverifiable Materials

- packages/lore/src/flows/drift-flow.ts and the three omitted test files: Excluded from diff per truncation manifest; behavior inferred only from attested test passes, not direct inspection.
- AC-DR-9 full command output: Captured output_tail truncated mid repair-hint line.

## Facts Summary

- AC coverage: 9 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.38
