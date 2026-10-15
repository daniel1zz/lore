---
id: TASK-1350
type: task
role: plan
title: "AC-RT-2 declared command omits lore context init so it can never pass"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"ac-oracle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c5eda1c5-dc52-4b80-b5d8-e7eff9044a13"}
---

spec-always-loaded-rules-keep-only-what-no-checkpoint-enforces AC-RT-2 script runs lore init then lore context refresh in a fresh mktemp project. lore context refresh exits 1 there (no CLAUDE.md found, run lore context init first); stderr is sent to /dev/null, so no .claude/rules is written and the command fails at the grep step regardless of fragment content.

**Expected:** The declared command reaches the fragments check and rules:project char assertion
**Actual:** Fails with: grep: .claude/rules: No such file or directory; fixed by inserting lore context init before lore context refresh

Reported by: agent:session-66711aa8
