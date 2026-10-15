---
id: TASK-775
type: task
role: plan
title: "[Skill:test] final verification — full suite, attested AC coverage, drift and assess"
status: deprecated
priority: critical
phase: "P6: Verification"
created: 2026-08-23
updated: 2026-10-10
tags: []
parent: PLAN-138
plan: PLAN-138
---
Estimate: M
Source: plan Exit Criteria; Invariants 1-6
Dimensions: D-FUNC, D-CODE

Final verification phase. Runs on main AFTER every branch is merged, never inside a worktree.

AC:
- Both test runners pass on the FULL suite on main, with the turbo cache defeated (`--force`) so the verdict is not a cached read of a worktree's own run
- `lore verify <plan>` produces an attested pass for every script-mode AC on the governing spec — exit code decides, never self-asserted
- Every one of the 14 spec ACs carries evidence; `lore ac list` shows no AC with zero pass records
- Spec code anchors are declared for the landed implementation (`lore anchor add` per key file, AFTER the code lands) and `lore status --check-drift` is exit 0
- `lore status --check-tree --check-drift`, `lore audit --verify`, `--check-prd-budget`, `--check-claude-md` and the anchor-coverage ratchet are all exit 0 — the full pre-push chain
- The AC-GI-13 regression guard from P0 is still green, proving no phase reintroduced the GitHub back door
- `lore assess <plan>` run and its findings triaged: each either fixed or accepted with a written rationale
