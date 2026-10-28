---
id: KN-812
type: knowledge
role: knowledge
title: "Milestone review: Repeat-check degradation reported"
status: approved
priority: medium
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-252
links:
  - {id: PLAN-252, type: informs}
---
# Milestone review: PASS

Fingerprint: 5d678e1b52d425740eb493c46429ccc2ee705ffe3d6beeb0800028f5c5f8c060
Diff: derived from 4 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | pass | Trusted runners show both criteria failing first and then passing. AC-RL-1 has expected-fail then pass runs in github-filing-split-write.test.ts. Its tests cover: an unreadable log (via the injected readReceiptLog) that still files and reports reason 'unreadable' with skipped_lines 0; corrupt lines that still recognise prior #99 with 'corrupt_lines' and 2 skipped; corrupt lines with no prior that file a new issue; and a clean or missing log that adds no field. AC-RL-2 has expected-fail then pass runs, twice, in mcp-github-filing.test.ts. Those tests cover the lore_report_issue MCP payload carrying repeat_check_degraded, its absence on a clean log, and the exact one-line formatRepeatCheckWarning text for both endings. Typecheck passes. There are no milestone overrides. | attested evidence for task-rl-t1-repeat-check-degradation-on-the-filing-result; AC-RL-1; AC-RL-2 |
| spec_conformance | pass | Each Scope item is implemented. GithubFilingContext.readReceiptLog is optional and defaults to new ReceiptLogV2(path).read(). describeRepeatCheckDegradation gives {unreadable, detail, 0} or {corrupt_lines, detail, n}, and the repeat check still runs over priorReadResult.value.entries when lines are corrupt. degradedField is spread into both the early retried:true return and the final filed return. report-issue.ts prints the warning on stdout right after the dedup_degraded Warning line. The second commit changed the ending to follow `retried`, which matches the spec ('— recognised from the readable entries.' on the early return, otherwise 'filed anyway'). The MCP tool passes the result through, so tools.ts needed no edit; the AC-RL-2 MCP test shows the field arrives. Nothing outside Scope was added. Refusal (D1) and BR-501 are untouched. The BR-500 rewrite is a post-landing 'lore rule apply' step, as the plan says. | spec Scope and Design Decisions D1–D3; report-issue-wiring.ts fileGithubIssue, formatRepeatCheckWarning; commands/report-issue.ts |
| regression | pass | The full-suite run on main attributes no failing files to this plan. All eight failures (done-worktree-cleanup, sync-push, bulk-lifecycle, and others) are tied to other work. The behaviour at risk was the existing filing result shape and repeat recognition on a clean log. The field is omitted when the read is clean (conditional spread), and the AC-RL-1 HAPPY test asserts both no field and retried:true on a clean prior. The existing GS-T7 and AC-GR-11 tests in the same files pass in the attested whole-file run. | full-suite run at 030b26717a7ea189ab89bf0bc9160e528e2f4769; attested 'test pass' of both whole test files |
| design_necessity | pass | Every technical choice has an external precedent. (1) The injected receipt-log reader follows the dependency-injection / ports-and-adapters pattern; the spec explains why: a CI run as root can still read a mode-000 file. (2) Continuing past a degraded local log while reporting the problem follows Sentry SDK transport and npm cache behaviour on a corrupt cache (the spec's benchmark). (3) Putting a structured degradation field next to dedup_degraded follows the partial-results pattern, like Elasticsearch's _shards.failed in a successful response. (4) The single stdout 'Warning:' line copies the existing BR-501 dedup warning style. (5) Omitting an optional field when it is absent follows TypeScript exactOptionalPropertyTypes practice. | Fowler, Inversion of Control Containers and the Dependency Injection pattern; Sentry SDK transport / npm cache degraded-continue; Elasticsearch _shards partial results; BR-501 dedup_degraded precedent |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-500 (unknown: no-code-anchors) (The only cited rule, BR-500, is in state unknown (no-code-anchors). No rule is contradicted, so this dimension cannot fail.) | Cited rule state: BR-500 unknown (no-code-anchors) |
| concurrency_safety | pass | The change only reads the receipt log, through the same ReceiptLogV2.read the code already used, and derives a value from that read. It adds no write, lock or shared mutable state. The read-then-file window between two concurrent filings already existed and BR-497's intent record covers it. This change neither widens nor narrows that window. | report-issue-wiring.ts fileGithubIssue priorReadResult; append-only JSONL log semantics |
| security | pass | No new input path or privilege is added. The injected reader is an internal context field, not exposed to the CLI or MCP. The detail string is either the local read error message (a local file path or errno) or a list of line numbers. It goes back to the same local user or agent who started the filing. It contains no credentials and is not sent to GitHub, because the issue body is unchanged. | OWASP information exposure guidance; report-issue-wiring.ts describeRepeatCheckDegradation |
