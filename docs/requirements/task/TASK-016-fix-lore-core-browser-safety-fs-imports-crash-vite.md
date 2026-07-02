---
id: TASK-016
type: task
role: plan
title: "Fix @lore/core browser safety — fs imports crash vite dev SPA"
status: archived
priority: critical
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-002
plan: PLAN-002
---
Found by SPEC-022 Playwright e2e: @lore/core barrel (index.ts) re-exports telemetry.ts and config.ts which do top-level 'import { appendFileSync... } from "fs"' / readFileSync. Vite dev-mode browser-external stub throws at module-load time, so ANY import from @lore/core (dashboard imports createDocInputSchema/getAllowedTransitions/types) blank-screens the SPA before React mounts. 'lore dashboard' is broken for real users today. Production build only survives via a rollupOptions.external workaround in dashboard vite.config.ts (13581bf). Fix at root: make @lore/core safe to import in a browser; then the prod workaround should become removable. Oracle: playwright e2e suite (merged, currently failing at scenario 1) must go green.
