---
id: TASK-655
type: task
role: plan
title: "Verify assess finding paths against the assessed commit, withdraw unverifiable findings without dropping them silently, and exclude the generated mirror from the diff"
status: draft
priority: high
phase: "assess-verify"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-123
plan: PLAN-123
---
AC-JV-1 / AC-JV-2, D1-D4. An assess MAJOR was exactly BACKWARDS: it named the SOURCE side of rename R099 in b791d657 as defective, i.e. the very name that merge fixed, and the file exists at neither HEAD nor the worktree. Nothing could have caught it: typedGapSchema (packages/core/src/assessment.ts:390-395) is {dimension, severity, ac_ref?, statement} with NO path field, and there is no path check anywhere on the assess result path (suppressUngroundedAbsenceFindings at ai-provider-service.ts:338 filters only on based_on: absence). Add paths: z.array(z.string()).default([]) — default [] or every stored assessment stops parsing — and require the prompt to enumerate in paths every path a finding names in prose. Verify each against the commit resolved from extra.diff_source (set at adapters/cli/commands/assess.ts:397) via git cat-file -e <commit>:<path>: the ASSESSED COMMIT is the referent, so a path present there but absent from the worktree is KEPT. An unverifiable finding moves to unverifiable_findings[] with the failing path and the commit checked, is counted in paths_verified, and leaves the scored set — but overall_score stays byte-identical to what the judge emitted, because the severity-to-score arithmetic lives in the judge LLM and re-deriving it would be inventing arithmetic this corpus has never used. A commit that cannot be resolved fails LOUD naming it, never silently reads as an absent path. Separately, assess-template.ts:615 calls truncateDiffByFile with NO path exclusions; one run truncated 5.3M chars and most of it was the generated mirror. Remove docs/requirements/** before truncation via a single named constant.
