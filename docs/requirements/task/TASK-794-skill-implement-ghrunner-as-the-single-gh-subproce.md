---
id: TASK-794
type: task
role: plan
title: "[Skill:implement] GhRunner as the single gh subprocess seam, with three distinct error codes"
status: draft
priority: critical
phase: "P0: Runner + error taxonomy"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-778, type: blocks}
---
Estimate: M
Approach: node `execFile` with an argv array (never shell:true), an explicit maxBuffer, and `gh api` JSON output only — never `gh issue` presentation output. Copy the child-process-to-Result shape already proven in packages/lore/src/adapters/real-mcp-registrar.ts (ENOENT names the missing binary plus the manual command; non-zero exit carries a bounded stderr tail).
Source: spec Scope entry `GhRunner`; risk R2 (repo redirection); the ENOBUFS precedent recorded at adapters/cli/assess-render.ts:152
Dimensions: D-FUNC, D-CODE
Scope-Alt: the RATE_LIMITED reset-value parsing can be reduced to carrying the raw header string without structural parsing
Covers: AC-GI-2, AC-GI-7, AC-GI-8

AC:
- Given the anchored test files from the paired red task, When they run, Then all cases pass
- Given a repo-wide literal scan for the closed token set `gh api`, `gh issue`, `gh auth`, `gh repo` over .ts sources under packages/lore/src, When gh-runner.ts exists, Then no file outside gh-runner.ts matches (AC-GI-7's oracle, exit 0)
- Given `exitCode` in adapters/cli/utils.ts, When the three new codes are mapped, Then each maps to a code distinct from 1 and from each other, and the existing mappings are unchanged
- Given the env-scrub scenario, When any GhRunner invocation runs, Then the four GH_* names are absent from the child env
- A full-repo typecheck is exit 0 (Invariant 1)

Integration: GhRunner has NO production caller in this phase by design — the live filing path is rewired in P2. This task therefore must NOT claim AC-GI-1. Its acceptance is the runner contract plus the single-spawn-site scan; reachability is proven in P2 and only there.
