---
id: TASK-121
type: task
role: plan
title: "T1 — relationship provenance + actor fidelity (link/unlink/tree-fix audit, opts.by threading)"
status: archived
priority: medium
phase: "Wave 1 — provenance + chain"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-030
plan: PLAN-030
links:
  - {id: TASK-119, type: blocks}
---
Implements SPEC-079 G1+G2 (AC-079-1, AC-079-2). CorpusService.link/unlink write audit actions link/unlink (doc_id=from, details {to_id, link_type / removed types}); TreeCheckService applied repairs write tree-fix audit entries; CorpusService.create/set/delete/link/unlink accept opts.by, fallback resolveActorWithSource(undefined, process.env); links.created_by = resolved actor; CLI/MCP/HTTP thread the resolved actor. No versions rows for link ops; VERSION_ACTION_AUDIT_FAMILY untouched. Vitest suites at the two canonical AC paths, six-dimension coverage.
