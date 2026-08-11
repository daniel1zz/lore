---
id: TASK-665
type: task
role: plan
title: "Make the AC-FR-10 mirror oracle drive the read-only check instead of the write-mode exporter so it can actually fail and stops dirtying the live corpus"
status: draft
priority: high
phase: "readonly-oracle"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-124
plan: PLAN-124
---
AC-OX-1 / D1. scripts/tests/spec-mirror-export.test.ts establishes its baseline with runMirrorScript([]) — the exporter in WRITE mode — and only then asserts parity. That single line makes AC-FR-10a structurally incapable of a red (the export IS the repair) and dirties .lore/export-index.json plus docs/requirements/** on every suite run, which reds the NEXT run through the pollution guard. Nothing in AC-FR-10's text requires the write: it mandates only that the assertion run against the production corpus (per-type file count equals live corpus count, filename id byte-identical to frontmatter id zero-padded to 3 digits, links_broken === 0) — all three hold under a read-only --check. Switch the oracle to runMirrorScript(['--check']), add a seeded-drift case proving it goes RED, and assert git status --short .lore docs/requirements is empty after the run. Also correct the gap-ledger entry for G19, whose recorded scope points at a branch that no longer exists while the defect is on main. DO NOT run bun run mirror:export from a worktree.
