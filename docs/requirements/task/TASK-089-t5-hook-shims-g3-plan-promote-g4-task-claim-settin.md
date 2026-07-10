---
id: TASK-089
type: task
role: plan
title: "T5: hook shims g3-plan-promote + g4-task-claim + settings.json wiring"
status: archived
priority: high
phase: Hooks + e2e
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-022
plan: PLAN-022
links:
  - {id: TASK-088, type: blocks}
---
## Task Objective
Create two PreToolUse hook shims mirroring `hooks/g2-spec-promote.sh` EXACTLY in structure (fail-open contract, LORE_GATE_BYPASS short-circuit, jq payload parse, mandatory doc-type pre-check via `lore get --json`, then gate, then allow/deny mapping):
- `hooks/g3-plan-promote.sh`: fires on Bash `lore approve <plan>` / `lore set <plan> --status (in-review|approved)` (and MCP) where the doc resolves to a **plan** → `lore gate plan-promote --plan <id>`.
- `hooks/g4-task-claim.sh`: fires on Bash `lore claim <task>` (and MCP `lore_claim`) where the doc resolves to a **task** → `lore gate task-claim --task <id>`.
Wire both into `.claude/settings.json` PreToolUse (Bash matcher + MCP matchers), alongside existing g1/g2.

## Spec Reference
§3 IN(4,5), §5.4. ⛔ FAIL-OPEN: any anomaly (jq/binary/lookup/parse/undocumented-exit) → allow + stderr log. Only a real gate exit-4 on a real in-scope command denies. Doc-type pre-check is MANDATORY (else every `lore approve`/`lore claim` on non-plan/non-task docs false-blocks).

## Acceptance Criteria
- G3 denies only when target is a plan AND plan-promote gate exits 4; allows approve/set on non-plan docs untouched.
- G4 denies only when target is a task AND task-claim gate exits 4; allows claim on... (claim is task-only, but still pre-check).
- Both honor LORE_GATE_BYPASS=1 (allow before touching stdin).
Verified via the T6 e2e (hook-level behavior) + shell-level smoke.

## Context Digest
`hooks/g2-spec-promote.sh` is the reference implementation — copy its structure verbatim, change: the command-shape regex, the expected doc type (plan/task), the gate subcommand + flag. Hooks read `$CLAUDE_PROJECT_DIR/dist/lore`. settings.json currently wires g1+g2 under a Bash matcher and g1 under an MCP `lore_create` matcher.

## File Anchors
- NEW `hooks/g3-plan-promote.sh`, `hooks/g4-task-claim.sh` (chmod +x)
- EDIT `.claude/settings.json` (PreToolUse: add g3/g4; add MCP matchers for lore_create is N/A — use approve/set/claim shapes)
- READ `hooks/g2-spec-promote.sh`
