---
id: TASK-1573
type: task
role: plan
title: "[Skill:implement] TG-38 spec-promote refuses a script AC whose oracle file is missing and not ledgered not-built"
status: draft
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: 2026-10-18 another session approved two specs (AC-IV-*, AC-SMM-*) whose oracle test files did not exist and had no row in scripts/ac-oracle-not-built-ledger.json; check:ac-oracle-ownership on main went red (10 findings) until peers added rows by hand. The approval path should refuse it at the source: the spec-promote checkpoint (checkpoint-registry.ts spec-promote) evaluates, per script AC, the same owner-file existence check:ac-oracle-ownership uses (share the function, do not copy it) and refuses exit 4 naming each AC whose owning file is missing unless a not-built row exists for it (consumer projects without the ledger file: the --allow-missing-path declaration recorded on the AC is the equivalent — decide and state which). Red-first: approve a spec with a missing oracle and no ledger row -> exit 4 naming the AC; control: with a ledger row -> approves.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-5; incident 2026-10-18 (peer specs)
AC: red-first case and control green; check:ac-oracle-ownership unchanged.
