---
id: KN-007
type: knowledge
role: knowledge
title: "Dogfood retro: SPEC-027 self-hosted via plan/claim/evidence/assess"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-03
tags: [dogfood, spec-027, retro]
parent: PLAN-006
---
Full SPEC-023/025/026 workflow self-hosted for SPEC-027 (7 tasks, 5 parallel worktree agents, 23 evidence entries, assess verdict met 88/100). What worked: ready-computation gated waves correctly; claim badges made parallel ownership visible; append-only evidence (incl. deliberate pre-fix FAIL entries) gave the judge a real signal; independent tester agent surfaced a genuine StatusPill defect implementation would have hidden. Friction found: (1) archiving a completed task takes 3 status hops (approve, active, archived) — a completed->archived fast lane for tasks would cut ceremony; (2) assess char budgets truncated middleware.ts/HistoryTab.tsx diffs, judge had to score AC-DH-5/7 from tests alone (noted in its gaps) — consider per-file diff prioritization over global truncation; (3) eval placeholders scenario false-positives on JSX inside fenced code blocks of knowledge docs (RouterProvider/Outlet in 01KW6E4… docs) — placeholder parser should skip fenced code; (4) get --json nests under .data.doc while list uses .data.docs — trivially confusable, cost one false alarm about lost evidence.
