---
id: TASK-787
type: task
role: plan
title: "[Skill:implement] frontMatterCodec with identity redaction in @lore/core"
status: draft
priority: high
phase: "P2: Intake"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-774, type: blocks}
---
Estimate: M
Approach: a pure codec module in @lore/core (browser-safe, no Node builtins at module load — the dashboard imports this barrel). Serialise the six-field closed set into a delimited front-matter block at the head of the issue body; parse it back with an explicit absent result. Redaction happens here, before any text reaches a gh invocation.
Source: spec Scope entry `frontMatterCodec`; Risk R1 and its mitigation list
Dimensions: D-FUNC, D-CODE
Scope-Alt: tags may ship as a comma-joined scalar rather than a structured list
Covers: AC-GI-6

AC:
- Given the anchored test file from the paired red task, When it runs, Then all five cases pass
- Given the redaction path, When a reporter identity carrying an absolute home path is passed, Then the output carries the tilde form and the corpus name plus root-PRD id only
- Given the os-fallback actor tier, When identity is assembled, Then that tier's value is dropped entirely rather than redacted
- The module top-level-imports no Node builtin (asserted by the existing browser-safety convention for @lore/core)
- A full-repo typecheck is exit 0

Integration: this codec has no production caller until the intake port lands in this same phase. The port task, not this one, carries the reachability assertion.
