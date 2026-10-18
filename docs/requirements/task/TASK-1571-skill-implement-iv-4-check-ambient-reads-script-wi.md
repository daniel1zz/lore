---
id: TASK-1571
type: task
role: plan
title: "[Skill:implement] IV-4 check:ambient-reads script with ratchet ledger"
status: archived
priority: medium
phase: "P2 contract"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
links:
  - {id: TASK-1558, type: blocks}
---
Implement spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D5 (AS-26), modelled on scripts/check-no-timer-retry.ts: banned tokens and allowlist read from the spec's D5 section; ledger seeded from today's per-file counts; count above or below ledger fails (ratchet); --ledger-empty mode. Wire as package.json check:ambient-reads. Whether to add it to hooks/pre-push: report, do not decide.
