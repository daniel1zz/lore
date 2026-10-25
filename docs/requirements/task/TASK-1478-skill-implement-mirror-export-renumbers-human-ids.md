---
id: TASK-1478
type: task
role: plan
title: "[Skill:implement] Mirror export renumbers human_ids before rendering links, so one pass suffices"
status: deprecated
priority: medium
created: 2026-10-16
updated: 2026-10-23
tags: []
parent: PLAN-192
plan: PLAN-192
---
Estimate: S
Approach: mirror export renders each type in a fixed order (prd before spec), so when the same run renumbers a spec human_id (repairDuplicateHumanIds), links rendered earlier in that run still name the old id; a second export is needed. Run the human_id repair for every type before rendering any file, or render links after all renumbering.
Source: observed 2026-10-16 on main after task-skill-implement-r0-6 merged: the first repairing export left PRD-001 links at SPEC-095..102; check:spec-mirror exit 2 (stale identity frontmatter); a second export fixed it (commit after 3f2d51ff).
AC:
- In a throwaway corpus where a prd links to a spec whose human_id gets renumbered by the repair, ONE mirror export leaves check:spec-mirror at exit 0
