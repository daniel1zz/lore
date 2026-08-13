---
id: KN-063
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-27
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| Judgment | Confidence |
|---|---|
| Adhoc backlog cleared 8/8, all merged, dual-runner full green (vitest 340f/5898, bun 1121/0). Liveness root-caused: over-specified racy branch, not a hang — no-watchdog basis 20/20 under load. Two-project registry (lore+guyin) live in machine config, UAT accept_with_conditions@0.9 | — |

## Failing Oracle

(none)

## Next Steps

- 4 UAT-found adhoc tasks (lore ready --adhoc): FTS5 CJK search zero-hits (highest impact — CJK corpora unsearchable, tokenizer/bigram + FTS rebuild migration); nav links drop /p/:name prefix; bootstrap Origin allowlist hardcodes 5173; dashboard SIGTERM leaks vite child. Also SPEC-003 §6.2 still documents the old three-step XDG chain (lore set needed). Lesson recurred: parallel-wave semantic combination (store Result fix × liveness assertion) only surfaced on main full-suite — keep the merged-main full run mandatory
