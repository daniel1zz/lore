---
id: TASK-1391
type: task
role: plan
title: "lore gate spec-promote prints the advisory judge's decision (reject, confidence 0.72) with no reasons and has no --json, so the author cannot act on it"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ddff6668-7de6-422b-b6b4-172e6fbd6ddf"}
---

The spec-promote pre-flight runs the AI judge as an advisory and prints only its decision and confidence. An author who gets 'reject' has no way to learn which dimension failed before running lore review, which defeats the point of a pre-flight.

**Expected:** When the advisory judge runs inside lore gate spec-promote, its output carries the judge's reasons (or a pointer to where they are stored), and --json exposes decision, confidence and reasons
**Actual:** lore gate spec-promote --spec spec-session-trail-a-session-local-record-of-what-each-run printed only 'gate: pass (9 acceptance criteria declared)' and 'gate: judge advisory — decision=reject confidence=0.72'; --json is refused as Unknown option, so the reject cannot be traced to any dimension

Reported by: agent:session-2f964849
