---
id: TASK-972
type: task
role: plan
title: "Prose sweep: shipped assets say pull lore bootstrap when needed, not consume the injection"
status: archived
priority: medium
phase: "prose"
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: PLAN-157
plan: PLAN-157
---
Covers: AC-SI-5, AC-SI-7. Spec: spec-session-start-injection-carries-only-the-session-s-own D7. Rewrite every shipped 'hook-injected ... consume it directly / do not re-fetch / consume don't re-call / do not re-derive / already carries active_plans' instruction to: the session-start injection carries only the seat's own open claims and plan handoff; pull corpus state with lore bootstrap / lore ready <plan> / lore pending when needed. Feed rule bullet lists no corpus-global field as injected. Check asset parity pins (grep tests for each file name / body sha) and update them; refresh nothing in ~/.claude. Regenerate the assets manifest. Red-first: run the AC-SI-5 command before editing and record expected-fail.
