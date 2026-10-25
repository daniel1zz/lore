---
id: TASK-1650
type: task
role: plan
title: "Dashboard issues e2e specs exercise the current GitHub-backed report channel through a fake, not the retired SQLite upstream"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
links:
  - {id: TASK-1657, type: resolves}
---
Resolves #320. Both specs configure the retired feedback.upstream.{corpus_path,root_prd} (configureFeedbackUpstream) and file with dist/lore report-issue, which now exits 4 on that shape, so AC-074-1..4 and AC-ICL-9 fail. Rewrite them against the current report channel (GitHub-owned issue state) using the project's existing GitHub fake/stub transport for tests; read spec-github-owns-issue-report-state-no-mirror-task-work-carries for the current behaviour. Oracle: both specs pass under the dashboard Playwright runner.
