---
id: PLAN-136
type: plan
role: plan
title: "Close the falsify green-control gap: an unrunnable scratch worktree must record inconclusive, never a machine-proven red"
status: archived
priority: medium
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: SPEC-133
phases:
  - {name: "green-control", description: "Insert the unmutated green control before the mutation, downgrade to inconclusive when it fails, and prove it with a test that constructs an unrunnable scratch worktree"}
  - {name: "surface-oracle", description: "Close the assess MAJOR: an oracle that observes the PERSISTED row and drives the --falsify CLI branch, plus the launch-failure inconsistency"}
links:
  - {id: TASK-748, type: resolves}
---
Closes defect 01M0H8XP5JZTR8Q7BH6HV6YRM4 (task-lore-verify-falsify-compares-only-the-exit-code-so-an), measured 2026-08-21: 11 of 11 `lore verify --falsify` invocations recorded result:expected-fail + capture_source:runner while never executing their mutation — 10 criteria across 3 specs, a 100% false-match rate.

Three causes, all exiting 1, so no choice of expected_exit_code can separate them from a genuine assertion failure: (1) the scratch worktree has no usable node_modules; (2) untracked files are absent because the worktree comes from `git stash create` WITHOUT --include-untracked, so a red-first AC's brand-new test file is simply not there; (3) dist/lore is gitignored, so a compiled-binary oracle has no binary.

Fix (handoff 111 NS3): run the UNMUTATED command in the SAME scratch worktree BEFORE applying the mutation. When that green control exits nonzero the environment is unusable, so record `inconclusive` and no attestation instead of `expected-fail`. One step, catches all three causes, reads no output, needs no new syntax.

Sharpest consequence of the defect: cause (2) means a red-first AC's test file is by definition new and therefore untracked, so this mechanism was structurally LEAST able to verify exactly the criteria the red-first discipline is built around.

⛔ The 11 pre-existing false rows stay in the corpus (evidence is append-only). Do not treat any existing runner-attested expected-fail row as proof of discriminating power — only AC-MIS-2 and AC-TC-2 predate this session, and handoff 111 KD2/KD4 supersede the rest.
