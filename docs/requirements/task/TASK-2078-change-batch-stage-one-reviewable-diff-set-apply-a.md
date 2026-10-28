---
id: TASK-2078
type: task
role: plan
title: "Change batch: stage one reviewable diff set, apply all-or-nothing on approval"
status: draft
priority: medium
phase: "P3 Refusal and change batch"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
links:
  - {id: TASK-2077, type: blocks}
  - {id: TASK-2062, type: blocks}
  - {id: TASK-2065, type: blocks}
  - {id: TASK-2061, type: blocks}
---
Covers: AC-CL-4, AC-CL-5
Approach: knowledge sub_type change-batch (KNOWLEDGE_SUB_TYPES in types.ts; the record locks on approval). lore batch stage --file <changes.json> validates entries (baseline nodes only, no duplicate node, base_version = current) and creates one draft batch whose body is the per-node diff set; it writes no node. ReviewService.approve of a change-batch calls ChangeBatchService.apply inside ONE store transaction through the single write route (CorpusService.writeDoc family, service invariant): per entry the literal 'if (current.version !== entry.base_version) return staleBatch(' (falsifier) refuses the whole batch (exit 5); applyPatch(node, entry.patch) writes body and structured patch in the same version, naming the batch. lore reject applies nothing. Gates run in the service layer, so CLI, MCP and HTTP behave the same.
