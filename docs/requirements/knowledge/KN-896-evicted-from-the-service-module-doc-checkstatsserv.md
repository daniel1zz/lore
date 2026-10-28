---
id: KN-896
type: knowledge
role: knowledge
title: "Evicted from the service module doc: CheckStatsService ingest"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
---
Evicted verbatim from the module CLAUDE.md on 2026-10-23 (task G3: bring the file under its eviction floor). These are the pre-eviction lines; the module file keeps the rule and points here.

| `CheckStatsService` | `lore checks stats`: per-check runs/denials/last denial from `check_outcomes`, removal candidates (deny-capable checks only, >=30 days AND >=50 runs AND 0 denials), `quality(listIssues)` escaped defects per closed plan, `ingestHookOutcomes` (hooks append to a local JSONL carrying their cwd; ingest claims it by rename, takes only lines whose cwd is inside this corpus's project root and leaves other projects' lines in the file). `GateEnforcer` appends `gate:<checkpoint>` pass/deny rows through its optional `recordCheckOutcome` port. The 1-in-10 human sampling audit no longer exists |
