---
id: TASK-850
type: task
role: plan
title: "The escalate verdict has been overturned 17 times out of 17: it has never once produced a valid block, so it is pure cost"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"verdict-calibration","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"68aa7ce7-a803-4b9f-b0b2-a39ea3d89d7e"}
---

review_judgments allows three decisions: approve, reject, escalate. The calibration_records table records what the human actually did afterwards. Joining the two over this corpus gives a clear signal: approve was confirmed 324 times and overturned 0 times, so the approve verdict is trustworthy. But reject was overturned 14 times against 7 confirmed (67 percent false positive), and escalate was overturned 17 times out of 17 - a 100 percent false positive rate over its entire recorded history. escalate also carries blocking_questions and, for spec and adr, participates in the judgment-required gate on approve, so a verdict with no demonstrated validity is wired into a blocking path. Either the escalate criteria need to be redefined against the 17 recorded overturns, or the verdict should be retired and folded into reject.

**Expected:** A verdict that participates in a blocking gate should have a measurable track record of correct blocks. If calibration shows it has never been upheld, that is a signal to redefine or retire it, and the calibration data should surface that rather than sit unread.
**Actual:** escalate: 0 confirmed, 17 overturned. reject: 7 confirmed, 14 overturned. Both feed the same blocking path as approve, which has 324 confirmed and 0 overturned. Nothing reads calibration_records to surface this asymmetry.
**Repro command:** `sqlite3 .lore/lore.db "select j.decision, c.human_outcome, count(*) from calibration_records c join review_judgments j on j.id = c.judgment_id group by 1, 2 order by 3 desc;"`

Reported by: agent:main-orchestrator
