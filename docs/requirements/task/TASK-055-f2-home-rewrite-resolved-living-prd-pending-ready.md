---
id: TASK-055
type: task
role: plan
title: "F2 home rewrite: resolved living PRD + pending/ready panels + loop stats"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-013
plan: PLAN-013
---
SPEC-033 §2.2/§2.4-loop-panel. Home page rewrite: render resolved PRD via existing resolve-mdx HTTP route + resolved_components React rendering (ChildrenOf → linked list w/ status chips; RecentDecisions/ActivePlans/HealthStats typed renderings; NO spliced-markdown-as-HTML). Side panels: pending (judgment badges via apiGetJudgments batch or pending payload), ready tasks, calibration stats table + audit-verify chip. Owns shared component components/judgment-badge.tsx (F3 will consume). Existing design system only (shadcn + SPEC-031 typography). Dashboard vitest for components. Anchors: packages/dashboard/src pages/home + components; do NOT touch pending page or doc-detail page (F3 owns them).
