---
id: TASK-1342
type: task
role: plan
title: "RED test task in a TDD pair can never reach lore done: its only evidence is expected-fail, yet it blocks its impl task"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"gate-design","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d0cb367b-72a3-409d-b16b-da25bc00b894"}
---

lore-plan's TDD injection makes [Skill:test] RED tasks block their [Skill:implement] task. Readiness requires every blocker archived; lore done requires an attested pass row. A RED task's oracle is red by design until the impl lands, so it cannot be archived first, and the impl stays blocked. The only route is lore done --override-attestation on every RED task — an audited escape used as the normal path.

**Expected:** A RED test task whose expected-fail evidence is recorded can be archived (or 'test blocks impl' is satisfied by recorded expected-fail evidence), with the pass later attested on the paired impl task
**Actual:** lore done refuses: holds no result:pass evidence row; impl task stays unready

Reported by: agent:session-ee1cedaf
