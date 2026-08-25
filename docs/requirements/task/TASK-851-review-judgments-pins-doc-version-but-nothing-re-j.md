---
id: TASK-851
type: task
role: plan
title: "review_judgments pins doc_version but nothing re-judges on edit: 227 of 232 judged docs carry a judgment for a version that no longer exists"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"judgment-staleness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c4528c44-0c7e-4583-916a-bc027d60c86e"}
---

Every judgment row stores the doc_version it was made against, and the pending list honestly renders an outdated one as (stale). But no mechanism ever refreshes it, and the only available refresh is a full re-judge of the whole document. Because judging is document-level (one decision + one confidence for the entire doc, plus five structural checks), the cost of refreshing a 22-version spec after a one-line AC edit is a whole fresh AI call. In practice that call is not made, so the judgment layer describes historical text. Measured on this corpus: 227 of 232 judged docs are stale, only 5 match the current version. Worst drift is spec at 13 versions behind and task at 15. The coarse granularity is the cause, not a separate problem: a judgment scoped to the diff between two versions would be cheap enough to keep current, a judgment scoped to the whole document never will be.

**Expected:** Either a judgment is refreshed automatically when the doc it describes changes, or judging is scoped finely enough (version diff, per-AC) that refreshing is cheap enough to actually happen. A stale judgment should not be able to sit as the only AI signal on a doc indefinitely.
**Actual:** 98 percent of judged docs (227/232) carry a judgment whose doc_version is behind the current version. Nothing refreshes them and nothing blocks on their staleness. The (stale) marker is rendered but is advisory only.
**Repro command:** `sqlite3 .lore/lore.db "with latest as (select doc_id, doc_version, row_number() over (partition by doc_id order by created_at desc) rn from review_judgments) select l.doc_version = d.version as is_current, count(*) from latest l join docs d on d.id = l.doc_id where l.rn = 1 group by is_current;"`

Reported by: agent:main-orchestrator
