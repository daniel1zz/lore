---
id: TASK-2039
type: task
role: plan
title: "Q4 plan-close coverage reads every open issue and trusts issues filed in the same batch"
status: archived
priority: medium
phase: "Q"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-269
plan: PLAN-269
---
Resolves #402.

1. The plan-close open-issue reader (app.ts setPlanCloseIssuePort → GitHubIntakePort.listIssues: 'gh api repos/<repo>/issues?state=all&per_page=100', one page) misses open issues older than the newest 100. Read OPEN issues only, all pages (gh api --paginate, state=open), excluding pull requests. Keep other listIssues callers' behaviour unless they have the same defect (check and say).
2. Within one batch, an issue the batch filed or linked for a plan counts as open for that plan's close in the same run (it is open by construction), so the close does not depend on the listing having caught up. The record (extra.milestone_findings) stays the source of the dimension.

Live: manual batch on 2179016b filed #401 for plan-review-batch-hardening-fixed-issues-re-review-bounded and was refused at close in the same run.

Tests: reader paginates (fake gh returning two pages; an open issue only on page 2 covers); a closed issue never counts; a batch whose filed issue is absent from the listing still closes the plan as accepted with known defects in the same run.
