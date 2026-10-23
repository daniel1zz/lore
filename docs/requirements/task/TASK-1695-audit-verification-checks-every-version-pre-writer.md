---
id: TASK-1695
type: task
role: plan
title: "Audit verification checks every version; pre-writer history is backfilled as reconstructed instead of skipped by a cut-off date"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PLAN-206
plan: PLAN-206
---
Decision (user, 2026-10-19): end-state the audit completeness cut-off. Source: review of baseline-hygiene (reject 0.74, design_necessity class d): `audit.verify_since` (default 2026-07-06, packages/core/src/config.ts:749-764) makes the completeness check skip every version recorded before that date (BR-476, BR-481). The reason recorded in SPEC-035 D5 is transitional: versions known to predate the audit writers.

End state: verification checks every version. History that predates the audit writers is made explicit once: an idempotent upgrade (a `lore migrate` action, preview by default) writes, for each version that has no audit entry and predates the writers, a hash-chained backfill entry marked as reconstructed (naming the version, the reason and the upgrade run), so verification distinguishes "audited", "reconstructed" and "missing" and never skips by date. The cut-off setting and the per-run cut-off option are removed; a config still setting it is refused naming the migrate action. Retire/restate BR-476/BR-481 and the hygiene leaf's Q2.

AC: red-first — (a) on a corpus with a pre-writer version lacking an audit entry, verification without the backfill reports it missing (exit 4) — no date skips it; (b) after the backfill, verification passes and reports the count of reconstructed entries; a second backfill writes nothing; (c) a config still setting the cut-off is refused naming the migrate action. Falsifier: today's date-based skip.
