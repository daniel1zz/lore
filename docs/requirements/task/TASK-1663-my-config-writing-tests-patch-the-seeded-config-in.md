---
id: TASK-1663
type: task
role: plan
title: "My config-writing tests patch the seeded config instead of appending duplicate keys"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
links:
  - {id: TASK-1666, type: supersedes}
---
Main is red since the DC2-5 atomic init landed: lore init now writes the full config template, so tests that appendFileSync to .lore/config.yaml create duplicate keys (refused by BR-926). test-config-writers-scan.test.ts flags audit-verification-checks-every-version.bun.test.ts:191/227/239 and retired-actor-identity-and-legacy-claims.bun.test.ts:106/144, and the latter's three AC-HID-4 'migrate config-keys' cases fail ('expected 4 to be +0'). Fix both files to use the patchLoreConfig / dropLoreConfigKey helpers. Oracle: bun run test:file packages/lore/tests/unit/test-config-writers-scan.test.ts packages/lore/tests/integration/retired-actor-identity-and-legacy-claims.bun.test.ts packages/lore/tests/integration/audit-verification-checks-every-version.bun.test.ts passes.
