---
id: KN-384
type: knowledge
role: knowledge
title: "Assessment: Audit remediation 2026-07-27 — parent-cycle write guard, MDX unknown-component strip, actor-identity guard (2026-07-27)"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-115
links:
  - {id: PLAN-115, type: informs}
---
# Assessment: partially_met (60/100)

Scope: plan `01KYHZEHWJJE2JSW1EFKTG3QVW`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| PLAN-1-PARENT-CYCLE-WRITE-GUARD | 82 | Strongest trail: tsc, four bun store/integration suites with pass counts, a vitest sweep incl. a dedicated parent-cycle-detection file, a build, and an e2e reproducing the audit's 2-node cycle showing LINK_CYCLE message and EXIT=4 plus a legal-reparent control. TursoStore parity only inferred from … | task-t1-parent-cycle-write-time-guard-detectparentcycle-walks (e2e [4] shows cycle rejection + exit 4; [2] output_tail gives per-suite counts) |
| PLAN-2-MDX-UNKNOWN-COMPONENT-STRIP | 60 | tsc + three suites pass, including an integration file named get-mdx-render that plausibly covers the CLI surface. But no output tails, no diff, and no e2e showing '' absent from `lore get` stdout with a warning on stderr — the task's own required assertion is unconfirmed. | task-t2-mdx-unknown-component-strip-from-rendered-output-cli (evidence [1]-[3], all self-reported, no output tail) |
| AC-IDENTITY-REJECT | 55 | A test file matching the spec's declared path (actor-identity-guard.bun.test.ts) passes, which is consistent with the predicate landing. Nothing shown proves rejection uses field gate:task-claim:actor-identity or the exact os_default collision condition; no diff, no output tail, no CLI exercise. | task-t3-actor-identity-guard-zero-evidence-release-advisory-all (evidence [2] only) |
| AC-IDENTITY-ESCAPE | 50 | No evidence item distinguishes the escape hatch. The single guard test file may or may not assert that workflow.gates."task-claim".actor_identity.enabled=false disables only this predicate and leaves others active; that scoping claim is untestable from the materials. | task-t3-actor-identity-guard-zero-evidence-release-advisory-all (no dedicated evidence) |
| AC-RELEASE-ADVISORY | 52 | release-advisory.bun.test.ts passes, covering some of the behaviour. The AC spans three surfaces — CLI exit 0 + warning line, --json warnings[], and MCP lore_release — and no e2e or MCP-level run appears; unit pass alone does not show the MCP tool path. | task-t3-actor-identity-guard-zero-evidence-release-advisory-all (evidence [3]) |

## Gaps

- Every one of the 11 evidence items is self-reported by the implementing agent (attested_count 0 across all three tasks). No independent oracle attestation exists, so all pass claims rest on the same actor that wrote the code.
- AC spans CLI (exit 0 + warning line), --json warnings[], and MCP lore_release. Only one unit test file (release-advisory.bun.test.ts) is evidenced, with no output tail and no MCP-path exercise. Two of three surfaces are unverified.
- The task explicitly requires asserting rendered TEXT (component absent) and the stderr surface, not just the warnings array. Evidence names a get-mdx-render integration test but supplies no output showing '' is gone from `lore get` stdout. This is framed as a security validation, so an unverified strip is consequential.
- No evidence distinguishes the escape hatch or shows that workflow.gates."task-claim".actor_identity.enabled=false disables only the identity predicate while other task-claim gates keep firing.
- No diff was provided (diff_available: false, tests_touched: false), so TursoStore parity for the parent-cycle walk, the gate:task-claim:actor-identity field name, and SPEC-071 tier interplay at utils.ts:349/373 cannot be inspected.
- The plan's oracle policy states a full two-runner suite runs once on main after merges. No post-merge full-suite evidence appears in the bundle, leaving cross-task interaction unverified.
- Zero knowledge docs linked. Three audit-confirmed defects (tree-column vs links-table divergence, whitelist-warn-but-keep rendering, identity collision) each carry a reusable root-cause lesson that was not captured.

## Recommendations

- Require an attested (non-self-reported) oracle run for at least the e2e and build oracles on any task remediating a confirmed audit finding, before the task may be archived.
- For security-framed tasks (T2 MDX strip), make an e2e capturing stdout and stderr of the built CLI a required evidence kind, in T1's style, rather than accepting unit/integration green as sufficient.
- Mandate output_tail on every test evidence item. T1 carried per-suite counts; T2 and T3 carried none, which drops the reviewer's ability to distinguish a real run from a stub.
- When a plan's tasks import ACs from an external spec (T3's three ACs), inline those AC texts into the bundle so assessment can score against verbatim criteria instead of task-description paraphrase.
- Record the post-merge full two-runner suite run as a plan-level evidence item so the plan's own oracle policy is closed out.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 59853ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: PLAN-1-PARENT-CYCLE-WRITE-GUARD

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 65 | 0.6 | evidence | T1 convincingly delivered (e2e reproduces audit cycle, exit 4). T2/T3 show only green unit/integration runs; the security-visible and MCP-visible behaviours the tasks require are unconfirmed. |
| evidence_integrity | 42 | low | absence | 0/11 items attested, no diff, no tests_touched signal, and T2/T3 lack output tails. Only T1 carries verifiable detail; the rest is agent self-report of green runs. |
| scope_fidelity | 82 | 0.65 | evidence | Three tasks map 1:1 to the three declared scope items; deferrals (remote/multi-user, AC-NOAI-7, spec-text) are named as out of scope. No drift visible, though absent diff limits confirmation. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | Every one of the 11 evidence items is self-reported by the implementing agent (attested_count 0 across all three tasks). No independent oracle attestation exists, so all pass claims rest on the same actor that wrote the code. |
| outcome | major | AC-RELEASE-ADVISORY | AC spans CLI (exit 0 + warning line), --json warnings[], and MCP lore_release. Only one unit test file (release-advisory.bun.test.ts) is evidenced, with no output tail and no MCP-path exercise. Two of three surfaces are unverified. |
| outcome | major | PLAN-2-MDX-UNKNOWN-COMPONENT-STRIP | The task explicitly requires asserting rendered TEXT (component absent) and the stderr surface, not just the warnings array. Evidence names a get-mdx-render integration test but supplies no output showing '' is gone from `lore get` stdout. This is framed as a security validation, so an unverified strip is consequential. |
| outcome | minor | AC-IDENTITY-ESCAPE | No evidence distinguishes the escape hatch or shows that workflow.gates."task-claim".actor_identity.enabled=false disables only the identity predicate while other task-claim gates keep firing. |
| evidence_integrity | minor | — | No diff was provided (diff_available: false, tests_touched: false), so TursoStore parity for the parent-cycle walk, the gate:task-claim:actor-identity field name, and SPEC-071 tier interplay at utils.ts:349/373 cannot be inspected. |
| evidence_integrity | minor | — | The plan's oracle policy states a full two-runner suite runs once on main after merges. No post-merge full-suite evidence appears in the bundle, leaving cross-task interaction unverified. |
| scope_fidelity | minor | — | Zero knowledge docs linked. Three audit-confirmed defects (tree-column vs links-table divergence, whitelist-warn-but-keep rendering, identity collision) each carry a reusable root-cause lesson that was not captured. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require an attested (non-self-reported) oracle run for at least the e2e and build oracles on any task remediating a confirmed audit finding, before the task may be archived. | All 11 evidence items here are self-reported; the implementing agent is the sole witness to its own fix. |
| plan | For security-framed tasks (T2 MDX strip), make an e2e capturing stdout and stderr of the built CLI a required evidence kind, in T1's style, rather than accepting unit/integration green as sufficient. | T1 shows the pattern works and is checkable; T2's identical class of claim is currently opaque. |
| process | Mandate output_tail on every test evidence item. T1 carried per-suite counts; T2 and T3 carried none, which drops the reviewer's ability to distinguish a real run from a stub. | Evidence without output is indistinguishable from an unrun or vacuous suite. |
| plan | When a plan's tasks import ACs from an external spec (T3's three ACs), inline those AC texts into the bundle so assessment can score against verbatim criteria instead of task-description paraphrase. | The bundle declares no ACs, forcing pseudo-AC construction and conservative scoring. |
| process | Record the post-merge full two-runner suite run as a plan-level evidence item so the plan's own oracle policy is closed out. | The policy is declared but no corresponding evidence exists in the bundle. |

## Unverifiable Materials

- Implementation diff for all three tasks: diff_available: false; no changed-file list, so code correctness, TursoStore parity, and field naming cannot be inspected.
- Test file contents / assertions: tests_touched: false and no output tails for T2/T3; only test file names and a pass verdict are visible.
- Spec spec-claim-time-actor-identity-guard-zero-evidence-release-advis verbatim ACs: Not included in the bundle; only the task description's paraphrase of AC-IDENTITY-REJECT / -ESCAPE / -RELEASE-ADVISORY is available.
- MCP lore_release response payload: No evidence item exercises the MCP surface named in AC-RELEASE-ADVISORY.
- `lore get` stdout/stderr for an unknown MDX component: No e2e or captured output demonstrating the component is stripped and a warning reaches stderr.
- Post-merge full two-runner suite run: Declared by the plan's oracle policy but absent from the evidence bundle.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 0 declared criteria
- Task evidence: 3 tasks
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.00
