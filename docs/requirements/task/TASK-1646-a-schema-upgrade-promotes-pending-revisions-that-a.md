---
id: TASK-1646
type: task
role: plan
title: "A schema upgrade promotes pending revisions that a landed spec change set accounts for to approved versions"
status: archived
priority: critical
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
links:
  - {id: TASK-1653, type: resolves}
---
Resolves #323. Migration 028 made rule changes already landed by a spec's change set (applied_at set; reviewed through the spec, BR-1211) into pending revisions, because pre-BR-1211 rule apply demoted the leaf and 028 took approved versions from the last approved node version. End state: a corrective schema migration (next free number; coordinate with lore-f3's RQ-C, which also wants the next number) that, for every baseline node, promotes each pending revision whose content equals the latest applied entry of some spec's change set for that rule (add -> the rule as landed; modify -> the statement/examples landed; retire -> retired) to the approved version, writes one version row and one hash-chained audit entry per changed node (actor: the migrating caller), leaves every other pending revision untouched, updates the rule registry, and is a no-op on a second run. AC: red-first test on a throwaway corpus at schema 28 with a node holding (i) a pending revision equal to a landed change-set entry and (ii) an unrelated pending revision: after the upgrade (i) is approved and live, (ii) stays pending; second run no-op. Then on the shared corpus BR-1346/1347/1348/1247/1273/1342/1343/1349 and the BR-1147/1148/1152 retirements become live/retired.
