---
id: PLAN-052
type: plan
role: plan
title: "Plan — SPEC-066 git-safety-gate heredoc awareness"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: SPEC-066
---
# Plan — SPEC-066 git-safety-gate heredoc awareness

## Goal
Implement SPEC-066: heredoc stripping + command-position triggers in pre-bash-git-safety-gate.mjs, SSOT + installed in lockstep.

## Oracle
AC-066-1..6 green via lore verify; git-safety-gate.test.ts + assets-ssot.test.ts green.
