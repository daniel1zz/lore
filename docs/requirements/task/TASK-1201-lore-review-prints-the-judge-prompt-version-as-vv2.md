---
id: TASK-1201
type: task
role: plan
title: "lore review prints the judge prompt version as 'vv2' (double v)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"954a29a7-1cd2-4350-b0cf-6fec595f6e6d"}
---

review-render.ts formats 'prompt v${judgment.judge.prompt_version}' (line ~74) while REVIEW_PROMPT_VERSION is the string 'v2' (ai/review-template.ts), so every printed judgment shows 'vv2'. Cosmetic, but the same string is what people quote when comparing judge versions.

**Expected:** Judge line reads 'prompt v2'
**Actual:** Judge line reads 'Judge: deterministic-checks (model: n/a, prompt vv2)' because the renderer prefixes v to a stored version that already starts with v
**Repro command:** `lore review <any doc with a failing deterministic check>`

Reported by: agent:review-excavator
