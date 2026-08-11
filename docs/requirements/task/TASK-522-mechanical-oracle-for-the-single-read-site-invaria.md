---
id: TASK-522
type: task
role: plan
title: "Mechanical oracle for the single-read-site invariant on feedback.upstream"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-07-30
tags: []
parent: PRD-001
---
lore assess flagged the SAME gap on two consecutive plans: invariants declared 'verified by diff' have no oracle, so whenever the diff is absent from the audit bundle they are unverifiable. Close the durable one. SPEC-OOB invariant 1 states that resolveFeedbackUpstreamCfg (packages/lore/src/adapters/cli/report-issue-wiring.ts) is the ONLY site reading config.feedback.upstream — an SSOT architecture constraint, not a one-shot condition. Verified true at the time of writing: a repo-wide grep finds exactly ONE direct read (report-issue-wiring.ts:135, 'return config?.feedback?.upstream'), with every other consumer (e.g. adapters/mcp/tools.ts:1944) going through the exported function. Task: add a source-level assertion test that scans packages/lore/src and packages/core/src for direct config.feedback reads and asserts exactly one, naming the permitted file, failing loudly with the offending file:line list when a second appears. Scan SOURCE TEXT (not a live grep subprocess) so the test is hermetic and runner-independent. Deliberately NOT covered here: invariant 2 (FeedbackConfigSchema untouched) is a one-time change constraint, not a durable property — a future schema change is legitimate; invariant 3 (configured-branch wording byte-frozen) already has behavioural cover via AC-OOB-6 direction 2. Exit condition: the new test passes, and a deliberately-introduced second read site makes it fail with a useful message (prove the negative control before claiming it works).
