---
id: TASK-1158
type: task
role: plan
title: "Issue-loop branch: 10 suspected defects (duplicate-title dedupe, 100-issue cap, verify drift, resolve lost update)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f523851c-151b-447a-8071-0b76598fc203"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) a different report reusing a filed title is not filed: Already filed, exit 0 report-issue-wiring.ts:577-593,770; (2) unreadable filing log skips the repeat check silently :768-784; (3) only the first 100 GitHub issues (PRs included) are read, no warning github-intake-port.ts:400, issues.ts:1002; (4) issues --verify reports every never-resolved report as drift, exit 11, even one filed a moment ago issues.ts:524-531; (5) label update failure after a recorded resolution exits 4 like a refusal issue.ts:96-102,906-917; (6) issue resolve writes back the copy read at start, losing a concurrent claim issue.ts:707,794-806; (7) archived/deprecated plan or task accepted as owner issue-resolution.ts:436-455; (8) a report rejected in review still reads open issues.ts:770-774; (9) live criteria name missing test files: AC-DC-1/2/3/5/6/7, AC-IC-1/2/4/5, AC-ICL-7, AC-ICL-11, AC-073-4; AC-DC-14 filter matches no test; (10) MCP tool description says reports go to an upstream pending-review queue, they go to GitHub adapters/mcp/tools.ts:3148

Reported by: agent:main-orchestrator
