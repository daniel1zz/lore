---
id: TASK-300
type: task
role: plan
title: "[Skill:manual] Owner sandbox smoke — install/re-run/uninstall (AC-046-F)"
status: archived
priority: high
phase: "verification"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
---
Estimate: S
Approach: HUMAN oracle — owner-run sandbox smoke on a real machine. UNCLAIMED by agents; the owner executes it. NEVER against the real ~/.claude.
Source: SPEC-046 AC-046-F.
Dimensions: D-FUNC, D-UX
Scope-Alt: none — this is the reversibility/integration acceptance gate.
Covers: AC-046-F

AC (human):
- Given a fresh sandbox `D=$(mktemp -d)`, When the owner runs `lore setup --claude-dir $D`, Then the receipt is correct (binary found, skills/agents/hooks written counts, MCP registered ✓ or skipped-with-manual-command, manifest + backup paths shown).
- Given the just-installed $D, When the owner re-runs `lore setup --claude-dir $D`, Then ALL entries report skipped (idempotent, zero writes).
- Given the installed $D, When the owner runs `lore setup --uninstall --claude-dir $D`, Then $D returns to its pre-install state: the manifest is absent and every backed-up file is restored byte-identically.
- SAFETY: run ONLY against a mktemp sandbox; NEVER the real ~/.claude.
