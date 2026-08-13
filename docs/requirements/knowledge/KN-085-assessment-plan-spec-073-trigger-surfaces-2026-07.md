---
id: KN-085
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-073 trigger surfaces (2026-07-24)"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-26
tags: []
parent: PLAN-044
links:
  - {id: PLAN-044, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KY9C7Z7VZ7SRE33TWNEP33JN`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-073-1 | 90 | Bun e2e test spawns compiled binary against throwaway corpora; HAPPY (configured→exactly 1 hint line + re-verify token) and BOUNDARY (unconfigured→stderr byte-empty) both pass, 1 attested by autopilot. buildReportIssueHint SSOT + gate.ts seam wiring visible. | 01KY9C97R8BKW5R23TXN9YBAGC (AC-073-1 attested pass) |
| AC-073-2 | 90 | Negatives covered: unknown flag exit-2 usage error (0 hints) and plain non-gate VALIDATION_ERROR illegal transition exit-4 (0 hints), both with upstream configured. 2 pass, 1 attested. buildReportIssueHint returns null for errClass null — scoping enforced at SSOT. | 01KY9C97R8BKW5R23TXN9YBAGC (AC-073-2 attested pass) |
| AC-073-3 | 90 | Corrupted .lore/lore.db (non-sqlite bytes) makes createApp throw synchronously; loader.ts try/catch emits Storage failure + 1 hint when configured, 0 when not. ERROR and STATE cases pass, 1 attested. Choke-point seam reasoning sound. | 01KY9C97R8BKW5R23TXN9YBAGC (AC-073-3 attested pass) |
| AC-073-4 | 87 | Stanza appended to assets/governance/corpus-workflow.md; assets-ssot.test.ts adds two token assertions ('lore report-issue' + 'Re-verify your own input first') so parity can't vacuously pass. 3 pass, 1 attested by autopilot. Full conformance suite green. | 01KY9C984R9HDSVB88BKS44AY6 (AC-073-4 attested pass) |

## Gaps

- Diff includes substantial SPEC-074 changes (dashboard IssueDetail/IssuesList/IssueReportsCard, issue-reports-routes.ts, routes.ts, playwright.config self-labeled SPEC-074 T2) outside this SPEC-073 plan's declared 2 tasks. Coherent separate-spec work, not accidental, but not declared here.
- attested_evidence_ratio 0.40 — 6 of the recorded evidence entries are agent self-reports; only one attested pass per AC. Error-path ACs (073-3) in particular rely on a single attested run.

## Recommendations

- Keep one branch/diff per plan so audit materials don't co-mingle SPEC-073 and SPEC-074 changes.
- Add a knowledge-capture handoff documenting the createApp synchronous-throw choke point for internal-error hinting.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 46722ms
- Retried: false
- Truncated sections: diff:packages/dashboard/tests/e2e/issues.spec.ts, diff:packages/lore/tests/unit/adapters/http-issue-reports.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.85 | evidence | All 4 ACs pass with ≥1 attested each; hint SSOT, gate/loader seams, and vendored stanza + token assertions all present and consistent with statements. |
| evidence_integrity | 84 | 0.8 | evidence | Every AC has an autopilot-attested pass with output tails; oracle kinds test+tsc. Weakened only by 0.40 attested ratio and 2 omitted (manifest-covered) test files. |
| scope_fidelity | 70 | 0.75 | evidence | SPEC-073 work (hint SSOT, gate/loader seams, stanza, tests) is on-scope and adapter-only per invariants; but diff also carries unrelated SPEC-074 dashboard/HTTP files not in this plan. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | minor | — | Diff includes substantial SPEC-074 changes (dashboard IssueDetail/IssuesList/IssueReportsCard, issue-reports-routes.ts, routes.ts, playwright.config self-labeled SPEC-074 T2) outside this SPEC-073 plan's declared 2 tasks. Coherent separate-spec work, not accidental, but not declared here. |
| evidence_integrity | minor | — | attested_evidence_ratio 0.40 — 6 of the recorded evidence entries are agent self-reports; only one attested pass per AC. Error-path ACs (073-3) in particular rely on a single attested run. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Keep one branch/diff per plan so audit materials don't co-mingle SPEC-073 and SPEC-074 changes. | Bundled diffs make scope-fidelity assessment ambiguous and inflate apparent surface area. |
| plan | Add a knowledge-capture handoff documenting the createApp synchronous-throw choke point for internal-error hinting. | Non-obvious bun:sqlite throw behavior; 0 knowledge docs linked. |

## Unverifiable Materials

- packages/lore/tests/unit/adapters/http-issue-reports.test.ts: Omitted per truncation manifest; treated as present-but-unseen, not scored against.
- packages/dashboard/tests/e2e/issues.spec.ts: Omitted per truncation manifest; SPEC-074 e2e, not scored against SPEC-073 ACs.

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.40
