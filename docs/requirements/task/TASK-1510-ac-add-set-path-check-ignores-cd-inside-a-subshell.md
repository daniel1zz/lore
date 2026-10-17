---
id: TASK-1510
type: task
role: plan
title: "ac add/set path check ignores cd inside a subshell group"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-197
plan: PLAN-197
---
Estimate: S
Approach: Measured on main 73cd8ce5 (2026-10-16): `lore ac set <spec> AC-AT-6 --command "o=$(mktemp); (cd packages/lore && bun test --timeout 30000 ./tests/integration/retirement-registry.bun.test.ts -t '...') > \"$o\" 2>&1; ..." --correction ...` was refused: "Declared script-mode command names path(s) that do not exist yet: ./tests/integration/retirement-registry.bun.test.ts" although packages/lore/tests/integration/retirement-registry.bun.test.ts exists. The same command without the subshell parentheses (`cd packages/lore && bun test tests/...`) was accepted. The ac write-path existence check resolves a path against the repo root when the `cd` is inside `( ... )`. Make the path resolution follow cd inside subshell groups (reuse the cd-chain resolution verify uses; one parser), with a red-first case.
Source: AS-17 (an oracle never reports over what it could not see) / write-path gate correctness
AC: the subshell form above is accepted when the file exists and refused when it does not.
