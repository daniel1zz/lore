---
id: TASK-629
type: task
role: plan
title: "T1 — injection resume_hint removal + derivation hygiene + prose neutrality (AC-096-1..4)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-117
plan: PLAN-117
---
Implement per spec D1-D4: (1) buildBootstrapInjection omits resume_hint for ordinary sessions, retains seat-scoped hint (seat exception D2); bootstrapInjectionSchema makes it optional; (2) SessionService.bootstrap handoff-pair collection skips status archived/deprecated and extra.validity-invalidated docs (one derivation site, benefits full report + injection); (3) assets/governance/corpus-workflow.md FEED bullet: latest_handoffs = neutral open-thread directory + explicit never-auto-resume prohibition; CLOSE bullet: drop stale resume-hint-as-fallback phrasing; manifest regen; (4) update pins: bootstrap-injection-compiled key-order/9-key regressions, session-service unit suite (new filter cases six-dimension), setup-governance-retirement prose pins. RED-first for new assertions.
