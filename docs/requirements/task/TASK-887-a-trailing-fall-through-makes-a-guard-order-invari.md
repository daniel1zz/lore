---
id: TASK-887
type: task
role: plan
title: "A trailing fall-through makes a guard-ORDER invariant unfalsifiable: reordering classifyFeedbackUpstream's vendor guard keeps the whole suite green"
status: draft
priority: medium
created: 2026-08-26
updated: 2026-08-26
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"unenforced-invariant","tags":["oracle","invariant","mutation-testing","feedback"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"bd2c45eb-314d-4a86-b002-5572b8ee90a5"}
---

classifyFeedbackUpstream (packages/lore/src/adapters/cli/report-issue-wiring.ts) documents a hard MUST: the vendor-consent guard has to be consulted BEFORE isGithubUpstreamCfg, whose predicate is '"repo" in cfg'. A vendor config carries no repo, so if the order is reversed it falls through and a legal config is reported to the user as the retired SQLite shape. The MUST is written in the function's own comments and in the ADR. Nothing enforces it. Measured 2026-08-25 by mutation, twice and independently (the implementer, then the orchestrator on main after merge): DELETING the vendor branch reddens 3 assertions including the MCP wiring one, but MOVING the guard one line down leaves the suite fully GREEN (18/18, then 22/22). The reason is structural, not a missing test case: the retired branch is a trailing fall-through rather than an else, so the two guards commute inside this function and no input distinguishes the orders. This also falsified a claim made in the dispatch bundle itself — the bundle asserted the reorder WAS the minimal red-producing mutation, and the measurement said otherwise; that false assertion had already been copied into source comments before the probe caught it. Generalizing: any ordering invariant guarded by early-returns above a trailing fall-through is unfalsifiable by construction, so 'what is the smallest mutation that turns this oracle red' (CLAUDE.md's fourth question) has no answer for the ordering half of such a contract. Candidate mechanisms: make the retired branch an explicit else/exhaustive switch over a discriminated shape so a reorder becomes a type error or a red test, or add a lint/AST check for order-dependent guard pairs. Prose in the function header is the layer that already failed here.

**Expected:** An invariant recorded as a hard MUST has at least one mutation that turns an oracle red. Reordering the vendor guard past isGithubUpstreamCfg should fail typecheck or redden a test, so a later refactor cannot silently break it.
**Actual:** Reordering the guard is fully green: 18/18 in the worktree, 22/22 on main after merge. Only wholesale deletion of the vendor branch is caught (3 failures). The ordering contract exists solely as prose in report-issue-wiring.ts and adr-the-vendor-intake-address-ships-in-the-binary-config, i.e. NOT ENFORCED.
**Repro command:** `cd packages/lore && sed -i.bak '381s|^|// |' src/adapters/cli/report-issue-wiring.ts && cd .. && bunx vitest run packages/lore/tests/unit/adapters/feedback-upstream-vendor.test.ts; echo EXIT=$?`

Reported by: agent:main-orchestrator
