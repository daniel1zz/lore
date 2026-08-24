---
id: KN-540
type: knowledge
role: knowledge
title: "Assessment: Collapse the retired-shape refusal to one definition and strengthen the exit-code-only green control (2026-08-24)"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-143
links:
  - {id: PLAN-143, type: informs}
---
# Assessment: met (89/100)

Scope: plan `01M0SPK92JNJGPE9RB9TJTSCDE`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MS-1 | 92 | Whole-tree grep oracle run twice, attested pass, echoing the PASS string; diff shows the only duplicate (adapters/mcp/tools.ts) replaced by a call to the shared builder. Second identical run adds nothing but does not weaken it. | task-skill-implement-export-buildretiredfeedbackupstreamerror (evidence [4],[5] lint) |
| AC-MS-2 | 88 | Both conditions evidenced: grep confirms the export, vitest -t 'AC-MS-2' passes (1 passed/2 skipped), typecheck clean. The equality assertion is near-tautological once tools.ts calls the builder directly; its anti-drift force rests on AC-MS-1, as the spec concedes. | task-skill-implement-export-buildretiredfeedbackupstreamerror (evidence [1],[2],[6]) |
| AC-MS-3 | 92 | vitest -t 'AC-MS-3' passes (2 passed/1 skipped). Diff shows both branches asserted against named values: unconfigured via imported buildUnconfiguredUpstreamRemedy (toEqual), GitHub via 'filing via'/'lore_report_issue' plus the load-bearing not.toContain of the retired fragment. | task-skill-implement-export-buildretiredfeedbackupstreamerror (evidence [7]) |
| AC-MS-4 | 90 | Structural grep for the literal plus the AC-IS-2 bun run both pass in one attested command (1 pass, 2 expect() calls — exitCode plus the new stderr substring). Full file also green (4 pass). Substring asserts only what the message already emits, as the plan requires. | task-skill-test-mcp-retired-shape-ssot-probes-plus-the-missing (evidence [2],[4]) |

## Gaps

- The docstring added to packages/lore/src/adapters/cli/report-issue-wiring.ts states the MCP copy 'had already drifted ("file issue reports" vs. this function's "file/list issue reports")'. The plan's measured baseline states the opposite — the MCP retired message is byte-identical to the classifier's, and the spec slug itself says 'two byte-identical'. No oracle in the trail decides which is true, so the shipped comment may misrecord history.
- packages/lore/src/adapters/mcp/tools.ts is imported by other suites (its own comment names mcp-tools.test.ts), but the only recorded runs are the two touched test files and bun run typecheck. No evidence shows the wider consumer suite still green after the destructure and return-type narrowing.
- AC-MS-2's behavioural equality check in packages/lore/tests/unit/adapters/mcp-issue-shape-message-ssot.test.ts compares the handler's message to the same builder the handler now calls, so it passes by construction and cannot detect drift on its own. Its discriminating power is entirely delegated to AC-MS-1's grep — acknowledged by the spec, but it means one of the two ACs carries no independent signal.

## Recommendations

- Require that any historical claim written into a shipped code comment (e.g. 'the copies had drifted') be backed by a recorded probe or match the plan's measured baseline table.
- When a widely-imported module such as adapters/mcp/tools.ts is edited, record at least one consumer-suite run alongside typecheck before archiving the task.
- Avoid recording the same lint oracle twice for one AC; prefer one run plus a distinct corroborating probe (e.g. grep count assertion) if extra confidence is wanted.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 57094ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 92 | 0.85 | evidence | All four ACs have attested passing oracle runs matching their declared commands; the diff implements exactly the SSOT collapse and the strengthened green control. |
| evidence_integrity | 88 | 0.8 | evidence | 11/11 evidence entries attested, red recorded before green, oracle commands mirror the AC scripts. Minor: one duplicated lint run, no wider suite run, truncated tails. |
| scope_fidelity | 90 | 0.8 | evidence | Diff touches only the four files the plan's P1/P2 anchors name; lazy import kept as instructed. Sole drift is a doc-comment claim beyond the measured baseline. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | minor | AC-MS-2 | The docstring added to packages/lore/src/adapters/cli/report-issue-wiring.ts states the MCP copy 'had already drifted ("file issue reports" vs. this function's "file/list issue reports")'. The plan's measured baseline states the opposite — the MCP retired message is byte-identical to the classifier's, and the spec slug itself says 'two byte-identical'. No oracle in the trail decides which is true, so the shipped comment may misrecord history. |
| evidence_integrity | minor | AC-MS-2 | packages/lore/src/adapters/mcp/tools.ts is imported by other suites (its own comment names mcp-tools.test.ts), but the only recorded runs are the two touched test files and bun run typecheck. No evidence shows the wider consumer suite still green after the destructure and return-type narrowing. |
| outcome | minor | AC-MS-2 | AC-MS-2's behavioural equality check in packages/lore/tests/unit/adapters/mcp-issue-shape-message-ssot.test.ts compares the handler's message to the same builder the handler now calls, so it passes by construction and cannot detect drift on its own. Its discriminating power is entirely delegated to AC-MS-1's grep — acknowledged by the spec, but it means one of the two ACs carries no independent signal. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Require that any historical claim written into a shipped code comment (e.g. 'the copies had drifted') be backed by a recorded probe or match the plan's measured baseline table. | The shipped docstring currently contradicts the plan's own baseline with no oracle to arbitrate. |
| process | When a widely-imported module such as adapters/mcp/tools.ts is edited, record at least one consumer-suite run alongside typecheck before archiving the task. | Typecheck plus two touched files leaves the blast radius of the edit unevidenced. |
| spec | Avoid recording the same lint oracle twice for one AC; prefer one run plus a distinct corroborating probe (e.g. grep count assertion) if extra confidence is wanted. | Duplicate identical runs inflate the pass count without adding information. |

## Unverifiable Materials

- Pre-change body of buildRetiredFeedbackUpstreamError in report-issue-wiring.ts: Not shown in the diff, so the docstring's drift claim vs. the plan's byte-identical baseline cannot be adjudicated from these materials.
- Full test-suite / mcp-tools.test.ts results after the tools.ts edit: No such run appears in the evidence trail.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
