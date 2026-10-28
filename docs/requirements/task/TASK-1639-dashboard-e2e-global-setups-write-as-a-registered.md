---
id: TASK-1639
type: task
role: plan
title: "Dashboard e2e global setups write as a registered party"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-26
tags: []
parent: PRD-001
---
Resolves #317. The dashboard Playwright global setups seed throwaway corpora with lore writes as plain child processes; since BR-1351 they are refused, so every dashboard e2e spec fails. Fix the setups to write as a known party: open a human session for the throwaway checkout (lore session start --human e2e-setup) or register a run and pass --harness-run, matching how the lore test helpers (tests/helpers/test-run-identity.ts) do it. Oracle: the dashboard e2e specs issues.spec.ts and issues-resolution.spec.ts (and the rest of the suite) pass.
