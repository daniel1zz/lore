---
id: TASK-924
type: task
role: plan
title: "Rule change set apply on landing, plan-close wiring, abandonment retires proposals"
status: archived
priority: medium
phase: "apply"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-151
plan: PLAN-151
---
Covers AC-CS-2, 3 (D2, D3, D4). lore rule apply <spec>: evidence-gated (every criterion citing a changed id has a runner-attested pass), one version per touched leaf naming the spec, proposed->live, modify rewrites, retire with note, idempotent; plan close of a plan implementing the spec calls apply and is refused while it would fail, naming the criteria; spec deprecated/superseded before landing -> proposed ids retired 'never landed: <spec>'; rule set --lifecycle deprecated refused naming retire and the change set (D4). Red-first.
