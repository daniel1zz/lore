---
id: TASK-1591
type: task
role: plan
title: "[Skill:fix] TG-41 AC commands that run a Node-project test file under the Bun config collect nothing; correct them and add a check"
status: draft
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: M
Approach: TG-23's one-runner rewrite set AC commands to `bunx --bun vitest run <files>` / `bunx vitest run <files>` under the default config, but the 20 files in vitest.node-files.ts are excluded from that config and only run under `--config vitest.node.config.ts`. Found 2026-10-18: AC-060-7 (inconclusive, 'ran 2 of 3 declared paths'; corrected by the orchestrator) and AC-069-11 (single Node-listed file + -t filter: the declared command collects nothing — reported by a peer session). Scan every live spec's script AC commands (lore list --type spec --json + lore get --json, or the scripts' existing corpus readers): for each command segment that runs vitest without vitest.node.config.ts but names a Node-listed file, correct the AC with lore ac set --correction (original command, the measured result of running it — exit code and 'No test files found'/collected count — and the corrected split: Bun files under the default config, Node files under --config vitest.node.config.ts), then lore verify it. Add a rule to scripts/check-ac-oracle-ownership.ts (or a sibling check wired into the chain) that fails naming spec/AC/file when an AC command runs a Node-listed file outside the Node config; red-first with a fixture. Respect the citation gate (exemption only if no rule fits, with reason).
Source: AC-060-7 EI-4 triage; peer report on AC-069-11 2026-10-18
AC: the scan reports 0 misrouted commands on main; each corrected AC verifies green; the new check is red-first and wired.
