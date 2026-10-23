---
id: TASK-1632
type: task
role: plan
title: "Every test reaching approve-nodes-cli.ts declares it"
status: approved
priority: medium
created: 2026-10-20
updated: 2026-10-23
tags: []
parent: PRD-001
links:
  - {id: TASK-1633, type: resolves}
---
Resolves #333. Add the '// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts' declaration to each test file that transitively spawns it via helpers/cli-live-rule.ts (13 files listed in #333), so the read recorder accepts them. Done when each listed file passes unfiltered via bun run test:file and a grep shows no importer of cli-live-rule.ts or the approve helpers lacking the header.
