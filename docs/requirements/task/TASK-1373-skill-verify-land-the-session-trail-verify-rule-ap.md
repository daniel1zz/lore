---
id: TASK-1373
type: task
role: plan
title: "[Skill:verify] land the session trail: verify, rule apply, leaf prose, anchors, full suite, build, Stop latency"
status: archived
priority: high
phase: "landing"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
---
Estimate: M
Approach (main agent, after every implement task is merged): (1) lore verify <plan>; if verify refuses criteria citing proposed rules, run lore rule apply first only if apply accepts, else report the ordering defect. (2) lore rule apply spec-session-trail-a-session-local-record-of-what-each-run-4. (3) In the same pass rewrite every touched node's prose so it states the landed rules (issue #212): 'Check a turn at its end' (Event: the review writes the turn's change summary and marks judged helper ends; Main session term aligned with the branch glossary; not-measured line), 'Hand off a session' (changed files from the trail; BR-343 open question closed by the landed modify), 'Attribute work to a run' (run tasks), 'Install the agent integration' (trail hooks), the Session branch ('only two things write' paragraph; 'the turn-end review only judges' line), and the new leaf's Constraint (version-control label). Review + approve each. (4) lore anchor add spec-session-trail-a-session-local-record-of-what-each-run-4 for the landed implementation files. (5) Full suite + typecheck on main; bun run build. (6) Record Stop added latency p50 over 20 runs on this repo both without and with the trail-review spawn, and SubagentStop measurement time, as manual evidence against the spec's targets.
AC: none of its own (lore verify attests AC-ST-1..12).
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
