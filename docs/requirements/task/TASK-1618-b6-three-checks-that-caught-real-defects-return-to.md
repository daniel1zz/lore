---
id: TASK-1618
type: task
role: plan
title: "B6 three checks that caught real defects return to landing, scoped to the branch's change"
status: archived
priority: medium
phase: "B"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones Part B (corrected) + corrected AC-LG-5 and BR-1368. Reference: Nx/Bazel affected (check only what the change touches); GitHub merge queue. Add a --changed <base> mode to each of the three scripts, computing the branch diff against main inside the integrate worktree: baseline-coverage only when the command registry changed and only for added/renamed commands; ac-oracle-ownership only for deleted/renamed/edited test files and ACs naming them; test-budgets only for changed test files. FLOOR_STEPS gains the three :changed steps; PLAN_CLOSE_STEPS keeps the full runs. Each :changed step on an unrelated branch must exit 0 in under 5 s. Measured: baseline-coverage caught 17 defects (median 18 s, max 349 s full), ac-oracle-ownership 7 (max 306 s full), test-budgets 2. Delete-by-default for anything only the old full-at-landing path needed.
