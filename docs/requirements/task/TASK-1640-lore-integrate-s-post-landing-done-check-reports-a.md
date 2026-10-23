---
id: TASK-1640
type: task
role: plan
title: "lore integrate's post-landing done check reports a landed branch's new oracle file as missing (checked before the shared checkout is refreshed)"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"integrate","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9b5e9e1e-2234-4136-acbf-49ef2b2c9a2d"}
---

Landing worktree-agent-a47f67afba78f4d46 (adds packages/lore/tests/integration/cli/run-message-address.bun.test.ts, the AC-MA-2 oracle) succeeded (landed on main as 7519782e, exit 0), but the task stayed unarchived with [floor: missing-oracle-file]. The log order shows the done attempt printed BEFORE 'rebuilding the shared checkout' and 'shared checkout refreshed to main', so the oracle-file existence check read the pre-landing checkout. Running 'lore done task-runs-record-their-messaging-address-on-every-register-run' right after, with no change, archived it (v22). Every landing that adds its own AC test file hits this and needs a manual done.

**Expected:** The post-landing done check resolves AC oracle files against the landed main tree (or runs after the shared checkout refresh), so a branch that adds its AC's test file is archived by integrate.
**Actual:** integrate: task-... stays unarchived [floor: missing-oracle-file]; main stays landed. Error: ... covers AC(s) whose oracle file is missing: AC-MA-2 (packages/lore/tests/integration/cli/run-message-address.bun.test.ts) — followed by 'integrate: shared checkout refreshed to main'. A manual lore done immediately after succeeds.
**Repro command:** `lore integrate <branch that adds the test file named by its task's AC command>`

Reported by: agent:session-95a34914
