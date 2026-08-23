---
id: TASK-780
type: task
role: plan
title: "[Skill:implement] delete the SQLite transport modules, retire its keys without removing them"
status: archived
priority: high
phase: "P4: Transport removal"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-775, type: blocks}
---
Estimate: M
Approach: delete flows/upstream-context-flow.ts, flows/upstream-probe.ts and toWriteContentionError. Turn the transport-selection keys .optional()-and-ignored with a warning each — NO config key is deleted anywhere, in this phase or any other (Invariant 4).
Source: spec Migration Plan P4 — the only phase whose module deletion has rollback `none`, gated on P0-P3 all verified
Dimensions: D-FUNC, D-CODE
Scope-Alt: nothing. The deletion is the phase.
Covers: AC-GI-14

⛔ IRREVERSIBLE for the module deletion. Do not start until every prior phase carries attested pass evidence.

AC:
- Given the anchored test file from the paired red task, When it runs, Then all four cases pass
- Given a repo-wide scan, When the deletion is complete, Then no source file references upstream-context-flow, upstream-probe or toWriteContentionError
- Given a config carrying both retired transport keys, When any command runs, Then it starts normally and warns once per key
- A FULL-REPO typecheck is exit 0, and both test runners pass on the full suite
