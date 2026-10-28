---
id: TASK-2001
type: task
role: plan
title: "Carrier: prefix every Bash call with the per-call run export; delete the text rewriter"
status: approved
priority: critical
phase: "P2 Carrier and verification"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-1993, type: blocks}
---
Covers: AC-RV-1 (AC-RV-4's residual grep is satisfied here and attested by the verification task)
Approach: HARNESS_RUN_ENV, prefixRunExport and the attest call prefixRunExport(command, runOfPayload(payload)) exactly as the spec's Public interface writes them (falsifier literals, verbatim, once). attest-input prefixes every Bash payload; tool-protocol payloads keep the structured harness_run insertion. Delete transform, rewriteBashCommand, stripHarnessRunFlag and their test file. The hook stays a blind pipe (no permission decision, BR-1218).
Branching: this branch starts the P2+P3 chain; it is NOT integrated alone (plan I5).
