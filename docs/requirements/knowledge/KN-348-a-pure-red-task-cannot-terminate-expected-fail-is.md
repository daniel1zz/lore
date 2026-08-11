---
id: KN-348
type: knowledge
role: knowledge
title: "A pure RED task cannot terminate — expected-fail is valid evidence but lore done refuses it; blocks links are advisory"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: [dogfood, defect, red-green, task-lifecycle, readiness]
parent: PLAN-105
---
# A pure RED task cannot terminate — `expected-fail` is accepted as evidence but `lore done` refuses it

## Measured, 2026-07-29

Two findings from dispatching a red-green plan (`plan-implementation-out-of-box-reporting-channel-self-provision`), both observed directly, not inferred.

### 1. `lore done` deadlocks a pure RED task

Two RED tasks completed their work (test suites authored, observed failing for the intended reason, merged to main) and recorded `--result expected-fail` evidence. `lore done` on both returned **exit 4**:

> Task "…" holds no result:pass evidence entry — lore done requires at least one passing oracle verification before archiving ("expected-fail", "fail", and "inconclusive" entries never count)

This is individually correct — archiving on a failing oracle would be exactly the false-completion `lore done` exists to prevent. The problem is systemic: **the corpus accepts `expected-fail` as a first-class evidence result, and the plan-close gate explicitly names a RED/TDD task as the canonical `attestation_exempt` case** ("red before green: the evidence is real, attesting it would misrepresent an intentionally-red state as verified") — so the model KNOWS pure-RED tasks exist. But no terminal path is provided for one.

Consequence chain, each link already demonstrated in this same session: a pure RED task cannot reach a terminal status → it stays `draft` forever → `plan-terminality` reports its plan as having a non-terminal child → **the plan can never close**. That is the identical drift class this session opened by sweeping six of them.

Workable resolution (used here): a RED task earns its `pass` evidence AFTER the paired GREEN task lands, by re-running the same command that is now green. This is honest — the test file genuinely passes — but it makes RED-task closure depend on a sibling task, which nothing in the tooling expresses or enforces. The alternative (never split RED and GREEN into separate tasks) contradicts the `expected-fail` vocabulary's own reason for existing.

### 2. `blocks` links are advisory — they gate `lore ready`, not `lore claim`

`lore ready` correctly reported T3 as BLOCKED by an unmet blocker. A probe then claimed that same task directly:

```
lore claim task-t3-core-upstream-resolver-config-writer --worktree /tmp/probe   → exit 0, "Claimed … (v2)"
```

So `blocks` shapes the readiness computation only; it is **not** an execution-layer interlock. This is worth stating plainly because both CLAUDE.md and the corpus-workflow snippet instruct dispatchers to "pick a ready task from `lore ready`" — phrasing that reads as a guarantee. It is a recommendation. A concurrent orchestrator that skips `lore ready` (or an agent handed a slug directly) can claim into an unmet dependency with no denial.

Not filed as a defect: the two-tier split may well be deliberate (readiness advisory, anchors enforcing). Recorded so the next session does not mistake `lore ready` for a safety property. The genuine enforcement boundary remains `noAnchorOverlap`, which runs unconditionally at claim time — and is only as strong as actor discipline.

## Why this is a knowledge doc rather than a filed issue

`lore report-issue` needs `feedback.upstream`, which no init/setup path provisions — it is unusable out-of-box. Repair is in flight as `spec-out-of-box-reporting-channel-report-issue-self-provisions`. This is the third consecutive session in which a lore finding had to be written down instead of filed.
