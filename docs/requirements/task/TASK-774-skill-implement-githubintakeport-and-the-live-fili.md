---
id: TASK-774
type: task
role: plan
title: "[Skill:implement] GitHubIntakePort and the live filing-path rewiring"
status: draft
priority: critical
phase: "P2: Intake"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-783, type: blocks}
  - {id: TASK-777, type: blocks}
---
Estimate: L
Approach: GitHubIntakePort with exactly four ops — verifyTarget (assert `gh api user` login and read the pinned repo), searchDuplicates (substring match over cached titles first; the network search is a fallback, never on the hot path, because /search/issues is a 30/min bucket at 1054-1561ms measured), fileIssue, listIssues (BATCH — one call for N issues, never per-id). Then rewire IssueReportService so the LIVE `lore report-issue` path goes through it: GhRunner for the subprocess, frontMatterCodec for the body, ReceiptLogV2 for the intent/outcome pair. The target repo is resolved once from config and passed explicitly — never `-R` inferred from a git remote (Risk R2).
Source: spec Scope entries GitHubIntakePort and Per-Field Authority; the measured N+1 at issue-report-service.ts:779 (12 sequential gh api = 8682ms vs 786ms batched)
Dimensions: D-FUNC, D-CODE
Scope-Alt: the cached-title dedup can degrade to no dedup (it is advisory and never blocks filing) without blocking the plan
Covers: AC-GI-1

AC:
- Given the anchored e2e file from the paired red task, When it runs against the dedicated target repo, Then all five cases pass
- Given the live `lore report-issue` command, When it files, Then the call stack passes through GhRunner — asserted by the single-spawn-site scan staying green AND by the e2e succeeding with no other spawn path present
- Given a config with no `feedback.upstream.corpus_path` at all, When filing runs, Then it succeeds — proving the local-path dependency is gone rather than merely unused
- Given an env carrying GH_REPO pointing at a different repo, When filing runs, Then the issue lands in the configured target, not the env-named one (Risk R2)
- Given listIssues for 50 issues, When call count is compared against listIssues for 1, Then the counts are equal
- A full-repo typecheck is exit 0
- **Structural: the capability modules are ACTUALLY INVOKED, not reimplemented inline.** Two conjunctive checks, because the behavioural check alone is satisfiable by a copy: (i) a static assertion that the intake port module imports `frontMatterCodec` from `@lore/core` and `ReceiptLogV2` from the service layer — not merely that the body looks right; (ii) an injected spy for each, asserting the live filing path calls both exactly once per filing. An inline reimplementation of front-matter serialisation inside this port would produce a byte-identical body and pass every OTHER acceptance criterion here while leaving `frontMatterCodec` a zero-caller module — the four-times-measured false-green this plan claims to guard against, reproduced inside the very task meant to prevent it. Found by the pre-dispatch task audit, 2026-08-23.

Integration: THIS is the task that proves reachability. GhRunner, frontMatterCodec and ReceiptLogV2 are all zero-caller capabilities until this rewiring lands — their own ACs cannot and do not assert production wiring, by explicit design in their task content. If this task's AC passes while the live command still reads corpus_path, the plan has produced the exact false-green this repo has measured four times.
