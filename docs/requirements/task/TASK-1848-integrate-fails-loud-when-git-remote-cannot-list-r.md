---
id: TASK-1848
type: task
role: plan
title: "integrate fails loud when git remote cannot list remotes instead of treating a remote-tracking argument as local"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Defect found by the baseline excavation (residual sites, batch H3). IntegrateService.remoteOf (packages/lore/src/service/integrate-service.ts:297) returns undefined when `git remote` exits non-zero. Its callers (fetchRemoteTracking at :308, the fromRemote flag at :232) then treat an argument such as origin/main as a local rev: no fetch, no error, and integration proceeds against a possibly stale tip. This violates the no-silent-fallback invariant.

End state: remoteOf returns Result<string | undefined, LoreError>; a failed `git remote` is a git failure (gitFailure) that refuses the integrate before main moves. A rev with no slash, or whose first segment is not a configured remote, still resolves locally.

AC: a unit test with an injected git runner whose `remote` call exits 1 asserts integrate returns the git-failure error naming `git remote`, never calls fetch and never moves main. Falsifier: the current code (returns undefined, integrate proceeds).
