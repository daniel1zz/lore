---
id: TASK-059
type: task
role: plan
title: "D audit surface: lore audit CLI + verify + TWF coverage + details.version"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-014
plan: PLAN-014
---
SPEC-035 §2: service/audit-service.ts (query(filters), verify(since) exact join (doc_id,action,details.version) vs versions table, watermark audit.verify_since config default deploy date), cli commands/audit.ts (per-doc trail, --actor/--action/--since/--json, --verify exit 0/4 itemized), TaskWorkflowService claim/release/evidence append audit entries (actions claim/release/evidence), ALL audit writers add details.version, JudgmentService.record writes action=judge (if B landed; else leave TODO-free seam note), MCP lore_audit, app wiring. Anchors: service/audit-service.ts(new), task-workflow-service.ts, corpus-service.ts/review-service.ts/version-service.ts (details.version — minimal additive), cli/audit.ts(new), config.ts.
