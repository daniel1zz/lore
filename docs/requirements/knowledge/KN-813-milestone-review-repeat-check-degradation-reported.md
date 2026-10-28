---
id: KN-813
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

Fingerprint: eb29cdd6593e24176c946afa30f5797091d2b9ba19b4123e4b26a2b5a9bf4c84
Diff: derived from 4 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | pass | Both acceptance criteria have trusted-runner evidence: an expected-fail run followed by a pass. AC-RL-1 is the unit test in github-filing-split-write.test.ts. It covers four cases: an injected reader that returns an EACCES error still files once and reports reason 'unreadable' with skipped_lines 0; two corrupt lines still recognise the open prior issue #99 on the early return and report 'corrupt_lines' with 2; one corrupt line with no prior files a new issue with 'corrupt_lines' and 1; and a clean or missing log sets no field. AC-RL-2 is in mcp-github-filing.test.ts. It shows that lore_report_issue returns repeat_check_degraded when the log path is a directory (EISDIR), and that the CLI formatter produces exactly one Warning line with the ending chosen by the outcome. The typecheck passed. There are no milestone decisions waiting. | attested evidence for task-rl-t1-repeat-check-degradation-on-the-filing-result; tests/unit/service/github-filing-split-write.test.ts AC-RL-1; tests/unit/adapters/mcp-github-filing.test.ts AC-RL-2 |
| spec_conformance | pass | The diff implements each Scope item and nothing beyond it. fileGithubIssue takes an injected reader, readReceiptLog, which defaults to new ReceiptLogV2(path).read(). The field repeat_check_degraded {reason, detail, skipped_lines} is added through degradedField to both the early retried:true return and the final filed return. When lines are corrupt the read is still ok, so findPriorGithubFilings runs over the readable entries. report-issue.ts prints the stdout line through formatRepeatCheckWarning, right after the existing dedup Warning line. The line ends 'recognised from the readable entries' only on the early (retried) return and 'filed anyway' otherwise, which matches the spec's wording. tools.ts is not in the diff, but the MCP test shows the field reaches callers unchanged. The filing is never refused, which follows D1, and the duplicate hint (BR-501) is left alone. Rewriting BR-500 is deferred to `lore rule apply` after landing, as the plan says. | spec Scope and Design Decisions D1–D3; report-issue-wiring.ts fileGithubIssue / describeRepeatCheckDegradation / formatRepeatCheckWarning |
| regression | pass | Two behaviours are at risk: existing repeat recognition (GS-T7 and the existing split-write tests in the same file) and the existing CLI duplicate-check Warning line. Both test files pass in full under the attested runs. The new field is optional and absent on a clean read, and the HAPPY tests assert it is absent, so existing result consumers are unaffected. The full-suite run on main attributes no failing file to this plan. The 13 failing files are unrelated to it. | Full-suite run on main 857fa998: failing files attributed to this plan: none |
| design_necessity | pass | Each choice has an external precedent. (1) The injected receipt-log reader with a production default is constructor/parameter dependency injection, used so a root-run CI can still exercise a read failure. (2) Continuing on a degraded local cache while surfacing the degradation is graceful degradation as Sentry SDK transport and the npm cache do it, and it follows the BR-501 dedup_degraded precedent. (3) An optional result field beside the existing flag, plus one formatter shared by the CLI line, gives a single source for the message text, following the existing Warning style. (4) Checking the readable entries when some lines are corrupt is the skip-corrupt-records approach of JSONL and write-ahead-log readers. | Martin Fowler, Inversion of Control Containers and the Dependency Injection pattern; Sentry SDK transport / npm cache graceful degradation; Michael Nygard, Release It! (fail loud, degrade gracefully) |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-500 (unknown: no-code-anchors) (The only cited rule is BR-500, and its state is 'unknown (no-code-anchors)'. It is not contradicted, so this dimension cannot fail. The rule rewrite also lands after this review, through lore rule apply.) | Cited rule state: BR-500 unknown (no-code-anchors) |
| concurrency_safety | pass | The change adds no new writes or shared state. It reads the receipt log once, which happened before too, and derives a value object from that read. The intent and outcome writes and their ordering under BR-497 are unchanged, so concurrent filers face the same race as before and this change makes it no worse. | report-issue-wiring.ts fileGithubIssue: single priorReadResult read, no new mutation |
| security | pass | The new detail string comes from the local read error's message (or its code) and from corrupt line numbers. It goes only to the same user's stdout and to the MCP caller who triggered the filing. No credentials, tokens or env values are included, and no new input path or privilege is opened. The injected reader is an optional field on an internal context that only tests set. | OWASP Error Handling Cheat Sheet (no secrets in error output) |
