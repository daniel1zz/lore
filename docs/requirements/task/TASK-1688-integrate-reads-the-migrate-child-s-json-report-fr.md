---
id: TASK-1688
type: task
role: plan
title: "integrate reads the migrate child's --json report from stdout and stderr merged, so any stderr warning breaks it"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"integrate","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a2fb8af4-3487-4adf-a39b-b3c10811d148"}
---

IntegrateService.runSchemaMigration runs migrate_command with --json and parses the report from the child's combined output. A child that prints a warning to stderr (observed when the child resolved an OS-user actor and printed its warning) ends with non-JSON text, so a successful migration is reported as 'exited 0 but printed no readable --json report' and treated as failed.

**Expected:** the --json report is parsed from stdout alone; stderr is kept for the failure message
**Actual:** integrate: migrate exited 0 but printed no readable --json report (stderr warning appended after the JSON)

Reported by: agent:session-a979eecd
