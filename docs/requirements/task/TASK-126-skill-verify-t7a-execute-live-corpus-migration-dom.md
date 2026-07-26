---
id: TASK-126
type: task
role: plan
title: "[Skill:verify] T7a Execute live-corpus migration — domain sections §14-§22 (dry-run gated)"
status: draft
priority: critical
phase: "Phase 4: Corpus migration & close-out"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-123, type: blocks}
  - {id: TASK-125, type: blocks}
---
Estimate: L
Approach: main-agent corpus operation (NOT code): full dry-run over ALL sections first, then per-section live migration of the DOMAIN sections (§14-§22) only — each section: create domain-overview spec (verbatim prose) → approve it (full lifecycle) → link → `lore outline set` entry → shrink body; `lore status --check-prd-budget` advisory read after EVERY section; halt on any invariant failure. Core sections and ADR extraction belong to the successor task (T7b).
Source: SPEC-080 Migration Plan Phase 1; T6 report format
Dimensions: D-FUNC
Scope-Alt: none — per-section granularity IS the descope unit (any section can stop the batch without losing prior sections).
Covers: AC-080-1 (partial: domain sections), AC-080-9 (partial)

AC:
- Given each migrated domain section, Then per-section evidence recorded (oracle manual + `lore migrate prd-to-outline --section <key>` transcript + post-step `--check-prd-budget` advisory output).
- Given every migrated section, Then its domain-overview spec is approved (no fast-track) and reachable exactly 1 hop from the outline entry.
- Given `lore status --check-tree --check-drift`, Then exit 0 after the batch (no orphan/drift regressions).
- Given the root PRD, Then id 01KVZ4C445EK479938W1TYT3AJ and slug unchanged (I3), and every §14-§22 section body is replaced by its rendered outline entry.
