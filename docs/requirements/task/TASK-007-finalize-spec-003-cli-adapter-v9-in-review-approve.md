---
id: TASK-007
type: task
role: plan
title: "Finalize SPEC-003 CLI Adapter v9 in-review → approved"
status: archived
priority: high
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track A · Task A6

Spec: spec-cli-adapter (v9, in-review since 2026-06-28)

Background: v5-v9 were 5 rapid edits on 2026-06-28 polishing the §3.7 P2 extension table. Compare to confirm scope is closed:

1. `lore diff spec-cli-adapter --from 5 --to 9` — review accumulated edits
2. If no open issues: `lore approve spec-cli-adapter`
3. If gaps remain: `lore set spec-cli-adapter --content-file <patched>` then approve

Done when: SPEC-003 is approved and last update note explains the v5→v9 churn.
