---
id: TASK-1642
type: task
role: plan
title: "Dashboard e2e seeds create specs without a parent"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-26
tags: []
parent: PRD-001
---
Resolves #321. browse-ux.pw.ts and seed-multi-project-fixture.ts create specs with parent_id, which is refused (a spec takes no parent, BR-2), so the seed fails with 422 and the multi-project global setup fails. Seed specs without a parent (relate them to the tree through criteria citations where the test needs it). Then investigate the remaining failures named in #321 (read-flow AC-1 root PRD row, review-loop home child create, write-flow approve toast): fix those whose cause is the same seed or a stale test; for any distinct product defect, file its own issue with lore report-issue and report it. Oracle: the dashboard Playwright default run and the multi-project config pass, except tests tied to a separately filed issue.
