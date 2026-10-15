---
id: TASK-1314
type: task
role: plan
title: "Pin the CLAUDE.md contract's Content Tiers rule with regression assertions"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
Pin the Content Tiers additions to the shipped CLAUDE.md content contract (`assets/governance/claude-md-contract.md`, commit 101fd79b) with regression assertions in `packages/lore/tests/unit/assets/claude-md-contract-content.test.ts`, so a silent removal or rewording turns the suite red.

Pinned: the `## Content Tiers — what every session pays for` heading and its position before `## What Goes In vs What Stays Out`; the three-condition tier-1 test; "A tier-1 line states the rule, never the reasoning"; the three new OUT table rows and their homes; the rewritten root section 3 (Architecture = one-line invariants, design intent is tier 2); the module-taxonomy paragraph applying the tiers one level down; the retired wording "design intent and the *why* behind key decisions, not a" is absent.

Red: the same assertions run against `git show 101fd79b~1:assets/governance/claude-md-contract.md` fail.
