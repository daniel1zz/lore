---
id: TASK-661
type: task
role: plan
title: "Raise capture_timeout_ms and max_diff_chars to the values this repo proved it needs, and build the shipped-default drift checker"
status: draft
priority: high
phase: "defaults"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-122
plan: PLAN-122
---
AC-GD-1 / D1+D2. Two dogfood-validated values live ONLY in this repo's .lore/config.yaml and never reach a consumer: capture_timeout_ms is 600_000 at packages/core/src/config.ts:461 but 1200000 at .lore/config.yaml:44, and max_diff_chars is 24000 at packages/core/src/ai.ts:325 but 80000 at .lore/config.yaml:5-6. assets/project/lore-config-template.yaml carries neither, so a fresh lore init + lore setup --project gets the small values. Raise both CODE defaults (not the template — a template value only reaches projects created after it lands, a code default reaches every consumer on upgrade), each with a one-line comment citing the measurement that forced it AND the trade-off: a larger capture timeout is a ceiling that costs nothing extra, a larger max_diff_chars costs tokens on every assess. Then build scripts/check-shipped-defaults.ts with an exported main() returning an exit code and never calling process.exit (match scripts/check-ordinal-write-sites.mjs's armable shape): it compares this repo's .lore/config.yaml against what a fresh install materialises and exits EXACTLY 3 naming any value the repo overrides that the shipped surface does not carry. Its predicate is ABSENCE ONLY — a repo override duplicating a shipped value is redundant but harmless. Enumerate everything the checker flags on the real tree and fix or record each one in this slice. Do NOT edit .lore/config.yaml — the sibling remedy task owns that file.
