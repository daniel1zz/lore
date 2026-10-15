---
id: TASK-1255
type: task
role: plan
title: "lore evidence's mixed-runner guard enforces this repo's two-runner file-naming convention on consumer projects, refusing a single-runner Bun command on an ordinary .test.ts file"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"distribution-leak","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a6114e4d-8552-4295-b66e-dd107472b4ee"}
---

evidence-precheck.ts:360-373 treats every non-.bun.test.ts token under bun test as another runner's file; the refusal (evidence-precheck.ts:438-439) asserts 'This repo splits test files across two runners (root CLAUDE.md ...)', false in a consumer project. lore verify runs the same command and attests pass. Found by probe v3 Q2.

**Expected:** The guard applies only where the project declares a split-runner convention; a consumer project's single-runner command is accepted as it is by lore verify
**Actual:** fresh consumer project: evidence --oracle test --command 'bun test tests/a.test.ts' --result pass -> exit 4 Mixed-runner (also with --capture); verify of the same AC command -> attested pass

Reported by: agent:main-orchestrator
