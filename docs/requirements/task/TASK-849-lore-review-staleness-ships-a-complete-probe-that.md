---
id: TASK-849
type: task
role: plan
title: "lore review --staleness ships a complete probe that has never run once: review_judgments.kind holds only review, and the audit trail has zero staleness rows"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"unarmed-mechanism","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"5b9ddc74-59ee-41aa-acb6-2bb550b75234"}
---

SPEC-044 built a staleness probe with a full flag surface: --staleness, --limit, --min-age-days, --fail-on-candidate, --list. The schema supports it - review_judgments carries a kind column precisely so staleness judgments can be distinguished from review judgments. On this corpus, kind has exactly one distinct value across all 580 rows: review. Zero staleness judgments have ever been written, and the audit table contains no staleness action rows either. This is the same shape as the verification_profiles gap that was armed on 2026-07-21: the mechanism shipped, nothing armed it, and every check over it is a vacuous pass. A probe that is never invoked provides exactly as much protection as no probe. There is no scheduled invocation, no gate that calls it, and nothing that reports it has never been used.

**Expected:** Either the staleness probe is armed on some trigger (a gate, a scheduled sweep, or a pre-push check) so that high-value knowledge and adr docs are actually probed, or the fact that it has never run is surfaced somewhere a reader will see it.
**Actual:** 580 review_judgments rows, all kind=review, zero kind=staleness. Zero staleness rows in audit. The probe has a complete CLI surface and has never been invoked.
**Repro command:** `sqlite3 .lore/lore.db "select kind, count(*) from review_judgments group by kind;"`

Reported by: agent:main-orchestrator
