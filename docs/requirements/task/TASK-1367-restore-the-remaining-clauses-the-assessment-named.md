---
id: TASK-1367
type: task
role: plan
title: "Restore the remaining clauses the assessment named and correct the re-baseline notes"
status: archived
priority: medium
phase: "W1"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-187
plan: PLAN-187
---
Second restore, from knowledge-assessment-always-loaded-lore-fragments-state-the-2 (AC-RW-5 scored 50). User decision 2026-10-16: no rule may be lost; the AC-RW-2 byte ceiling (10000) yields — the main agent corrects it to the measured total after this task, with an audited `lore ac set --correction`.

Restore (shortest rule-only wording, no explanation):
1. feed: `latest_handoffs` is a neutral directory, not a pointer to "the" thread.
2. feed: when authorship cannot be determined (no session marker), the floor arms (fail-safe) — account for the items.
3. produce: a legacy `workflow.gates."task-claim"` config is honored for phase-claim too (one deprecation warning per process).
4. evidence-attestation: stdout and stderr are merged in terminal order.
5. overview: projects without `.lore/` work normally (native plan mode + task tracking).
6. close: CLAUDE.md holds rules, prohibitions, thresholds, paths, commands (restore "prohibitions").
Then fix the RE-BASELINE comments in packages/lore/tests/unit/assets-ssot.test.ts so they state what each commit actually did: the reword commit shortened wording and its "no rule moved or dropped" claim was disproved by assessment (see the two assessment slugs); the first restore commit restored six instructions and also cut two clauses; this commit restores those.
No byte ceiling for this task; report the measured total.
