---
id: TASK-717
type: task
role: plan
title: "Thread real local-branch enumeration from the git port through lore territory into partitionTerritory's now-ready localBranches parameter"
status: archived
priority: medium
phase: "remediation"
created: 2026-08-12
updated: 2026-08-13
tags: []
parent: PLAN-129
plan: PLAN-129
---
The fourth wiring gap on this plan, same cause as the other three: partitionTerritory gained an optional localBranches parameter at merge 20898902, and nothing supplies it. Every real invocation of lore territory still passes undefined, so an unclaimed local branch is still dropped in production - the exact defect the parameter was added to fix.

The parameter's own module header records why: real-git-port.ts was under a live concurrent claim by agent:trailer-wiring at the time, outside that task's declared anchor. The implementer flagged it rather than expanding scope silently. That claim has since released and merged.

Scope: add a leaf enumeration function beside detectWorktreeBranch in real-git-port.ts (git for-each-ref refs/heads/), and pass its result from commands/territory.ts into partitionTerritory's 4th parameter.

⛔ undefined, NEVER []: enumeration that was not attempted or that failed must stay undefined so the partitioner reports unmeasured rather than known-absent. The distinction is already implemented on the partitioner side and must not be collapsed at the call site.

⛔ The AC must assert the LIVE call site. A unit test proving the enumeration function works, while lore territory --json still passes undefined, reproduces this exact gap one layer down.
