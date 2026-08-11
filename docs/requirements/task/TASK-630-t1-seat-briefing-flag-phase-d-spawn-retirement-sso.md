---
id: TASK-630
type: task
role: plan
title: "T1 — seat-briefing flag + Phase D spawn + retirement + SSOT content fix (AC-085-1..4)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-118
plan: PLAN-118
---
Implement SPEC-085 per D1-D4: (1) commands/governance.ts gains boolean --seat-briefing (bare invocation byte-unchanged); (2) hook Phase D: replace two-candidate file lookup with spawnSync of the resolved binary running governance --seat-briefing, keep placeholder substitution + fail-open + stderr-notice shape; (3) add governance/seat-briefing.md to RETIRED_FROM_INSTALL_PATHS; (4) fix assets/governance/seat-briefing.md On-exit section: drop the writer-guard-rejected create-knowledge path, keep lore handoff --by {{ACTOR}} as sole path; (5) regenerate assets-manifest; (6) update pinning suites: setup-governance-retirement (zero governance/ entries both views + hook/SSOT string pins), session-seat-injection (spawn-based Phase D), real-setup-ports and npm-install-simulation (seat-briefing no longer expected installed), extend governance-compiled e2e for the flag. RED-first for new assertions.
