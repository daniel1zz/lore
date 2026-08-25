---
id: TASK-848
type: task
role: plan
title: "The judge confidence field is collapsed: 85 percent of all 580 judgments sit in exactly two buckets (0.7 and 0.8), so any threshold over it has almost no discriminating power"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"confidence-calibration","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"074139f2-bd88-403e-ab30-10031b5fd9cd"}
---

review_judgments.confidence is a REAL constrained to 0..1 and is rendered next to every verdict (for example AI: approve 0.86). Its measured distribution over the full corpus is degenerate: 0.7 has 176 rows and 0.8 has 316, which is 492 of 580 or 85 percent in two buckets. 0.9 has 28, 1.0 has 27, 0.6 has 33, and nothing at all falls below 0.6. This is the standard self-reported-confidence collapse, and it means the field cannot separate a judgment the model is sure about from one it is guessing at. Any consumer that thresholds on it is effectively thresholding on a constant. Worth noting the field is not load-bearing today, which is exactly why this is cheap to fix now: either calibrate it against calibration_records (which already holds 362 confirmed/overturned outcomes to calibrate against), or drop the field rather than keep printing a number that carries no information next to every verdict.

**Expected:** Either confidence is calibrated so that its value predicts the calibration outcome (higher confidence should correlate with confirmed rather than overturned), or the field is removed so that no reader or future gate mistakes it for a signal.
**Actual:** 492 of 580 judgments (85 percent) report either 0.7 or 0.8. Nothing below 0.6 has ever been emitted. The number is printed next to every verdict in lore pending.
**Repro command:** `sqlite3 .lore/lore.db "select round(confidence, 1) as bucket, count(*) from review_judgments group by bucket order by bucket;"`

Reported by: agent:main-orchestrator
