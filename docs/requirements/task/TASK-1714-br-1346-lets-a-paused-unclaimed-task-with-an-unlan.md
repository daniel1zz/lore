---
id: TASK-1714
type: task
role: plan
title: "BR-1346 lets a paused, unclaimed task with an unlanded branch hold its anchors indefinitely; nothing makes paused work let go"
status: draft
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19 by lore-6c: integrate refused its branch under BR-1346 because packages/core/src/config.ts was 'held' by task-skill-fix-an-unparsable-project-config-is-silently-ignored. That task has no claim, but it is unarchived and its branch worktree-agent-a1bdd97e5f69195b3 holds 15 unlanded commits; it had been paused with no owner. The own-diff judgment counts an unarchived task as another live claim when it has a held claim, or a recorded claim on a branch that still exists and is not on main. The second clause is needed, because implementers release before landing. But a paused or abandoned branch then blocks every other landing on its anchors for as long as it exists, and no state says 'this work is parked'. Here the user handed the branch to lore-6c. End state to design: pausing work is an explicit, recorded act (e.g. lore park <task>) that drops the branch's hold while keeping the branch; and integrate's refusal names the holder's state (held claim vs unlanded branch, last activity), so the blocked session knows whom to ask or what to park. Oracle: a throwaway repo where task U's unlanded branch holds src/x.ts, so a branch changing src/x.ts is refused; after U is parked it lands; after U is resumed it is refused again.
