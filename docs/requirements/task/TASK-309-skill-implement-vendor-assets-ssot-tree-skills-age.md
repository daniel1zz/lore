---
id: TASK-309
type: task
role: plan
title: "[Skill:implement] Vendor assets/ SSOT tree (skills/agents/hooks/project)"
status: archived
priority: high
phase: "P0-assets"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-307, type: blocks}
---
Estimate: M
Approach: Copy the owner's live workflow assets from ~/.claude into the repo `assets/` SSOT tree, preserving directory structure. Mechanical vendoring — DO NOT author governance here (separate task owns assets/governance/).
Source: SPEC-046 Scope IN (P0 asset list); live sources at ~/.claude/skills/, ~/.claude/agents/, ~/.claude/hooks/, and repo hooks/.
Dimensions: D-FUNC (asset presence/fidelity)
Scope-Alt: none — every listed asset is required by AC-046-D.
Covers: AC-046-D (partial — file presence half)

Assets to vendor (exact set):
- assets/skills/  ← lore, lore-kickoff, lore-session, lore-doctor, lore-autopilot (from ~/.claude/skills/)
- assets/agents/  ← lore-explorer.md, lore-planner.md, lore-implementer.md, lore-reviewer.md (from ~/.claude/agents/)
- assets/hooks/   ← session-start-resume.mjs, stop-doc-sync.mjs, subagent-context.mjs, pre-subagent-gate.mjs, pre-no-general-agent-gate.mjs, lore-gate-g1..g4 (from ~/.claude/hooks/)
- assets/project/ ← g1-spec-create.sh, g2-spec-promote.sh, g3-plan-promote.sh, g4-task-claim.sh, pre-push, lore.tree.yaml template (from repo hooks/ + repo lore.tree.yaml)

AC:
- Given a clean repo, When this task lands, Then `assets/skills/`, `assets/agents/`, `assets/hooks/`, `assets/project/` each exist and contain EXACTLY the files listed above (no owner private files leaked, no extras).
- Given the vendored hook files, When `node --check` runs on each `.mjs` and `bash -n` on each `.sh`, Then all parse without error (fidelity, not corrupted-in-copy).
- Oracle: the assets-ssot conformance test task (AC-046-D) asserts the full presence set; this task's completion is proven GREEN there. Do NOT touch assets/governance/ (owned by the governance-authoring task).
